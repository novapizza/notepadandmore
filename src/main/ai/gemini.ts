import {
  AiProvider,
  AiRequest,
  BuiltRequest,
  ParsedChunk,
  BASE_SYSTEM_PROMPT,
  MODE_SYSTEM_PROMPT,
  composeUserMessage
} from './provider'

/**
 * Google Gemini provider (Generative Language API v1beta).
 *
 * Streaming uses `:streamGenerateContent?alt=sse`, which emits standard
 * `data: {json}` SSE lines. The API key travels in the `x-goog-api-key` header
 * rather than the documented `?key=` query parameter — same authentication,
 * but it stays out of URLs (and therefore out of logs).
 */

const HOST = 'generativelanguage.googleapis.com'
const BASE = `https://${HOST}/v1beta`

/** JSON Schemas for the structured modes. `responseSchema` is far more reliable
 *  than asking the model to "reply with only the text". */
const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    newText: { type: 'string' }
  },
  required: ['explanation', 'newText'],
  propertyOrdering: ['explanation', 'newText']
}

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    find: { type: 'string' },
    replace: { type: 'string' },
    isRegex: { type: 'boolean' }
  },
  required: ['explanation', 'find', 'isRegex'],
  propertyOrdering: ['explanation', 'find', 'replace', 'isRegex']
}

/**
 * Fallback when config holds nothing usable. Model ids drift with every Google
 * release, so this is only a starting point — Settings ▸ AI Assistant ▸ Test
 * connection queries /v1beta/models and repoints `aiModel` at something the
 * user's key actually has access to.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash'

/** Strip anything that can't legally sit in a URL path segment. */
function safeModelId(model: string): string {
  const cleaned = (model ?? '').trim().replace(/^models\//, '')
  return /^[A-Za-z0-9._-]{1,100}$/.test(cleaned) ? cleaned : DEFAULT_MODEL
}

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  host: HOST,
  // Suggestions shown before Test connection has fetched the live list. Newest
  // first; the older entries stay as fallbacks for keys without access to the
  // latest generation.
  defaultModels: [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ],

  buildRequest(req: AiRequest, apiKey: string): BuiltRequest {
    const model = safeModelId(req.model)
    const structured = req.mode === 'edit' || req.mode === 'find'

    const contents = [
      ...req.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      { role: 'user', parts: [{ text: composeUserMessage(req) }] }
    ]

    const body: Record<string, unknown> = {
      contents,
      systemInstruction: {
        parts: [{ text: `${BASE_SYSTEM_PROMPT}\n\n${MODE_SYSTEM_PROMPT[req.mode]}` }]
      },
      generationConfig: {
        // Deterministic for transformations; a little latitude for prose.
        temperature: structured ? 0 : 0.4,
        ...(structured
          ? {
              responseMimeType: 'application/json',
              responseSchema: req.mode === 'edit' ? EDIT_SCHEMA : FIND_SCHEMA
            }
          : {})
      }
    }

    return {
      url: `${BASE}/models/${model}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    }
  },

  parseChunk(line: string): ParsedChunk | null {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload) return null
    if (payload === '[DONE]') return { done: true }
    try {
      const json = JSON.parse(payload) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
          finishReason?: string
        }>
        promptFeedback?: { blockReason?: string }
      }
      if (json.promptFeedback?.blockReason) {
        throw new Error(`Request blocked by the safety filter (${json.promptFeedback.blockReason}).`)
      }
      const candidate = json.candidates?.[0]
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      const finish = candidate?.finishReason
      // MAX_TOKENS still yields usable partial text, so end normally and flag it
      // rather than erroring — the renderer notes the truncation on the message.
      const truncated = finish === 'MAX_TOKENS'
      return {
        text: text || undefined,
        done: finish ? true : undefined,
        truncated: truncated || undefined
      }
    } catch (err) {
      if (err instanceof SyntaxError) return null // partial line; transport re-buffers
      throw err
    }
  },

  buildListModels(apiKey: string): BuiltRequest {
    return {
      url: `${BASE}/models?pageSize=100`,
      headers: { 'x-goog-api-key': apiKey },
      body: ''
    }
  },

  parseModelList(body: string): string[] {
    try {
      const json = JSON.parse(body) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>
      }
      return (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort()
    } catch {
      return []
    }
  },

  parseError(status: number, body: string): string {
    let detail = ''
    try {
      const json = JSON.parse(body) as { error?: { message?: string; status?: string } }
      detail = json.error?.message ?? ''
    } catch {
      // Non-JSON error body; fall back to the status code alone.
    }
    if (status === 400 && /API key not valid/i.test(detail)) return 'The API key was rejected as invalid.'
    if (status === 401 || status === 403) return detail || 'The API key was rejected (unauthorized).'
    if (status === 404) return detail || 'That model was not found for your API key.'
    if (status === 429) return 'Rate limit or quota exceeded. Wait a moment and try again.'
    if (status >= 500) return `Gemini is unavailable right now (HTTP ${status}).`
    return detail || `Request failed with HTTP ${status}.`
  }
}

export const PROVIDERS: Record<string, AiProvider> = {
  gemini: geminiProvider
}

export function getProvider(id: string | undefined): AiProvider {
  return PROVIDERS[id ?? 'gemini'] ?? geminiProvider
}
