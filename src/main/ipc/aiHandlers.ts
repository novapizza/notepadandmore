import { ipcMain, net, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { AiRequest, AiTurn, BuiltRequest, AiProvider } from '../ai/provider'
import { getProvider, PROVIDERS } from '../ai/gemini'
import * as credentials from '../ai/credentials'

/**
 * IPC surface for the AI assistant. Every handler follows the repo convention of
 * never throwing: results are `{ …, error: string | null }`.
 *
 * All network I/O lives here because the renderer's CSP (`connect-src 'self'
 * https://google.github.io`, declared in both src/renderer/index.html and
 * CSP_POLICY in src/main/index.ts) blocks it — deliberately. Do not add provider
 * hosts to that policy; route new calls through this file instead.
 *
 * Hardening mirrors src/main/deeplink.ts: https only, hostname pinned to the
 * provider constant, all redirects rejected, wall-clock timeout, response byte
 * cap, and a per-window concurrency cap.
 *
 * Never log request bodies, response bodies, or keys here — document text and
 * credentials both flow through this module.
 */

const REQUEST_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_CONCURRENT_PER_WINDOW = 4
/** Belt-and-braces cap; the renderer truncates first and reports what it cut. */
const MAX_CONTEXT_CHARS = 400_000
const MAX_PROMPT_CHARS = 32_000
const MAX_HISTORY_TURNS = 40

interface InFlight {
  abort: () => void
  senderId: number
}

const inFlight = new Map<string, InFlight>()

function countForSender(senderId: number): number {
  let n = 0
  for (const r of inFlight.values()) if (r.senderId === senderId) n++
  return n
}

/** Reject a URL that does not land exactly on the provider's pinned host. */
function assertPinnedHost(rawUrl: string, provider: AiProvider): URL {
  const u = new URL(rawUrl)
  if (u.protocol !== 'https:') throw new Error('Refusing a non-HTTPS request.')
  if (u.hostname.toLowerCase() !== provider.host.toLowerCase()) {
    throw new Error(`Refusing a request to an unexpected host: ${u.hostname}`)
  }
  return u
}

/** Validate and clamp whatever the renderer sent before it reaches a provider. */
function sanitizeRequest(raw: unknown): { req: AiRequest | null; error: string | null } {
  if (!raw || typeof raw !== 'object') return { req: null, error: 'Malformed request.' }
  const r = raw as Record<string, unknown>

  const mode = r.mode
  if (mode !== 'chat' && mode !== 'edit' && mode !== 'find') {
    return { req: null, error: 'Unknown request mode.' }
  }

  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
  if (!prompt) return { req: null, error: 'Prompt is empty.' }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { req: null, error: `Prompt exceeds ${MAX_PROMPT_CHARS} characters.` }
  }

  const context = typeof r.context === 'string' ? r.context : null
  if (context && context.length > MAX_CONTEXT_CHARS) {
    return {
      req: null,
      error: `Document context exceeds the ${MAX_CONTEXT_CHARS.toLocaleString()}-character limit.`
    }
  }

  const history: AiTurn[] = Array.isArray(r.history)
    ? (r.history as unknown[])
        .filter(
          (t): t is AiTurn =>
            !!t &&
            typeof t === 'object' &&
            ((t as AiTurn).role === 'user' || (t as AiTurn).role === 'model') &&
            typeof (t as AiTurn).text === 'string'
        )
        .slice(-MAX_HISTORY_TURNS)
    : []

  return {
    req: {
      mode,
      prompt,
      context,
      contextLabel: typeof r.contextLabel === 'string' ? r.contextLabel.slice(0, 200) : null,
      history,
      model: typeof r.model === 'string' ? r.model : ''
    },
    error: null
  }
}

/**
 * Non-streaming request used by "Test connection". Resolves with the body text.
 */
function fetchOnce(built: BuiltRequest, provider: AiProvider): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = assertPinnedHost(built.url, provider)
    } catch (err) {
      reject(err as Error)
      return
    }

    const chunks: Buffer[] = []
    let received = 0
    let settled = false

    const req = net.request({
      url: url.toString(),
      method: built.body ? 'POST' : 'GET',
      redirect: 'manual'
    })
    for (const [k, v] of Object.entries(built.headers)) req.setHeader(k, v)

    const fail = (msg: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.abort()
      reject(new Error(msg))
    }
    const timer = setTimeout(() => fail('The request timed out.'), 30_000)

    // A well-behaved API never redirects; anything that does is suspicious.
    req.on('redirect', () => fail('Refusing to follow a redirect.'))

    req.on('response', (res) => {
      res.on('data', (chunk: Buffer) => {
        if (settled) return
        received += chunk.length
        if (received > MAX_RESPONSE_BYTES) return fail('Response was too large.')
        chunks.push(chunk)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== 200) {
          reject(new Error(provider.parseError(res.statusCode, body)))
          return
        }
        resolve(body)
      })
      res.on('error', () => fail('The connection failed while reading the response.'))
    })

    req.on('error', (err) => fail(err.message || 'The network request failed.'))
    if (built.body) req.write(built.body, 'utf8')
    req.end()
  })
}

/**
 * Start a streaming request. Chunks are pushed to `sender` only — never
 * broadcast — tagged with `requestId` so the renderer can route them.
 */
function startStream(
  requestId: string,
  built: BuiltRequest,
  provider: AiProvider,
  sender: WebContents
): void {
  const send = (channel: string, payload: object): void => {
    if (sender.isDestroyed()) return
    sender.send(channel, { requestId, ...payload })
  }

  let url: URL
  try {
    url = assertPinnedHost(built.url, provider)
  } catch (err) {
    send('ai:stream-error', { error: (err as Error).message })
    return
  }

  let settled = false
  let received = 0
  let buffer = ''
  /** Set when the model hit its own output cap, so the renderer can say so. */
  let truncated = false

  const req = net.request({ url: url.toString(), method: 'POST', redirect: 'manual' })
  for (const [k, v] of Object.entries(built.headers)) req.setHeader(k, v)

  // If the window is torn down mid-stream, drop the socket rather than leaving
  // it open and firing sends at a destroyed WebContents.
  const onSenderGone = (): void => inFlight.get(requestId)?.abort()

  /** Tear down the socket, the timer, and the registry entry exactly once. */
  const teardown = (): boolean => {
    if (settled) return false
    settled = true
    clearTimeout(timer)
    inFlight.delete(requestId)
    if (!sender.isDestroyed()) sender.removeListener('destroyed', onSenderGone)
    try {
      req.abort()
    } catch {
      // Already closed.
    }
    return true
  }

  const finish = (payload: { error?: string; truncated?: boolean }): void => {
    if (!teardown()) return
    if (payload.error) send('ai:stream-error', { error: payload.error })
    else send('ai:stream-done', { truncated: payload.truncated ?? false })
  }

  const timer = setTimeout(
    () => finish({ error: `The request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.` }),
    REQUEST_TIMEOUT_MS
  )

  inFlight.set(requestId, {
    senderId: sender.id,
    abort: () => {
      if (!teardown()) return
      send('ai:stream-done', { canceled: true })
    }
  })
  sender.once('destroyed', onSenderGone)

  req.on('redirect', () => finish({ error: 'Refusing to follow a redirect.' }))

  req.on('response', (res) => {
    // Non-200: the body is an error document, not an SSE stream. Buffer it whole
    // so the provider can turn it into a readable message.
    if (res.statusCode !== 200) {
      const errChunks: Buffer[] = []
      let errBytes = 0
      res.on('data', (chunk: Buffer) => {
        errBytes += chunk.length
        if (errBytes <= 64 * 1024) errChunks.push(chunk)
      })
      res.on('end', () =>
        finish({ error: provider.parseError(res.statusCode, Buffer.concat(errChunks).toString('utf8')) })
      )
      res.on('error', () => finish({ error: `Request failed with HTTP ${res.statusCode}.` }))
      return
    }

    res.on('data', (chunk: Buffer) => {
      if (settled) return
      received += chunk.length
      if (received > MAX_RESPONSE_BYTES) return finish({ error: 'The response was too large.' })

      buffer += chunk.toString('utf8')
      // SSE frames are newline-delimited; keep the trailing partial line.
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let parsed
        try {
          parsed = provider.parseChunk(line)
        } catch (err) {
          return finish({ error: (err as Error).message })
        }
        if (!parsed) continue
        if (parsed.text) send('ai:stream-chunk', { text: parsed.text })
        if (parsed.truncated) truncated = true
        if (parsed.done) return finish({ truncated })
      }
    })

    res.on('end', () => {
      if (settled) return
      // Flush a final unterminated frame before closing out.
      if (buffer.trim()) {
        try {
          const parsed = provider.parseChunk(buffer)
          if (parsed?.text) send('ai:stream-chunk', { text: parsed.text })
          if (parsed?.truncated) truncated = true
        } catch {
          // A truncated trailing frame is not worth failing the whole turn over.
        }
      }
      finish({ truncated })
    })

    res.on('error', () => finish({ error: 'The connection failed while streaming the response.' }))
  })

  req.on('error', (err) => finish({ error: err.message || 'The network request failed.' }))
  req.write(built.body, 'utf8')
  req.end()
}

export function registerAiHandlers(): void {
  // --- Credentials ----------------------------------------------------------
  // Note: there is intentionally no "get key" channel. The plaintext key never
  // crosses the context bridge.

  ipcMain.handle('ai:status', (_event, provider: string) => {
    const p = getProvider(provider)
    const s = credentials.status(p.id)
    return { ...s, provider: p.id, defaultModels: p.defaultModels }
  })

  ipcMain.handle('ai:set-key', (_event, provider: string, key: string) => {
    const p = getProvider(provider)
    if (typeof key !== 'string') return { error: 'Invalid API key.' }
    return credentials.setKey(p.id, key)
  })

  ipcMain.handle('ai:clear-key', (_event, provider: string) => {
    const p = getProvider(provider)
    return credentials.clearKey(p.id)
  })

  ipcMain.handle('ai:providers', () =>
    Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, defaultModels: p.defaultModels }))
  )

  /**
   * Validate the stored key and return the models it can actually use. Cheaper
   * and clearer than making the user burn a chat turn to find out the key is bad.
   */
  ipcMain.handle('ai:test', async (_event, provider: string) => {
    const p = getProvider(provider)
    const key = credentials.getKey(p.id)
    if (!key) return { ok: false, models: [], error: 'No API key is stored for this provider.' }
    try {
      const body = await fetchOnce(p.buildListModels(key), p)
      const models = p.parseModelList(body)
      return { ok: true, models, error: null }
    } catch (err) {
      return { ok: false, models: [], error: (err as Error).message }
    }
  })

  // --- Chat -----------------------------------------------------------------

  ipcMain.handle('ai:send', (event, provider: string, rawRequest: unknown) => {
    const p = getProvider(provider)

    if (countForSender(event.sender.id) >= MAX_CONCURRENT_PER_WINDOW) {
      return { requestId: null, error: 'Too many AI requests are already in flight.' }
    }

    const { req, error } = sanitizeRequest(rawRequest)
    if (!req) return { requestId: null, error }

    const key = credentials.getKey(p.id)
    if (!key) {
      return { requestId: null, error: 'No API key is stored. Add one in Settings → AI Assistant.' }
    }

    let built: BuiltRequest
    try {
      built = p.buildRequest(req, key)
    } catch (err) {
      return { requestId: null, error: (err as Error).message }
    }

    const requestId = randomUUID()
    startStream(requestId, built, p, event.sender)
    return { requestId, error: null }
  })

  ipcMain.handle('ai:cancel', (event, requestId: string) => {
    const entry = inFlight.get(requestId)
    // Only the window that started a request may cancel it.
    if (entry && entry.senderId === event.sender.id) entry.abort()
    return { error: null }
  })

}
