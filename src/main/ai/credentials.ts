import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * API-key storage for AI providers.
 *
 * Keys are encrypted with Electron's `safeStorage` (OS keychain / DPAPI /
 * libsecret) and written to `userData/config/ai-credentials.enc`. The plaintext
 * exists **only in the main process** — `src/preload/index.ts` deliberately
 * exposes no getter, so a compromised renderer cannot read the key back out.
 * The renderer only ever learns `hasKey` plus a last-4 `hint` for display.
 *
 * `safeStorage` requires `app.whenReady()`, so every entry point here is called
 * from IPC handlers (post-ready) rather than at module load.
 */

const FILE_NAME = 'ai-credentials.enc'

/** Shape stored on disk: provider id -> base64 of safeStorage.encryptString(). */
type Vault = Record<string, string>

function configDir(): string {
  return path.join(app.getPath('userData'), 'config')
}

function vaultPath(): string {
  return path.join(configDir(), FILE_NAME)
}

function readVault(): Vault {
  try {
    const raw = fs.readFileSync(vaultPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Vault = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    // Missing file or corrupt JSON both mean "no credentials".
    return {}
  }
}

function writeVault(vault: Vault): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const fp = vaultPath()
  // 0600: owner-only. A no-op on Windows (ACLs govern there), but correct on
  // macOS/Linux where userData is otherwise world-readable in some setups.
  fs.writeFileSync(fp, JSON.stringify(vault), { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(fp, 0o600)
  } catch {
    // Best-effort; some filesystems (exFAT, network shares) reject chmod.
  }
}

/** True when the OS offers a real encryption backend to store secrets in. */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Store `plaintext` for `provider`. Returns an error string when the platform
 * has no encryption backend — we refuse rather than fall back to a plaintext
 * (or trivially reversible) blob on disk.
 */
export function setKey(provider: string, plaintext: string): { error: string | null } {
  const key = (plaintext ?? '').trim()
  if (!key) return { error: 'API key is empty.' }
  if (key.length > 512) return { error: 'API key is implausibly long (over 512 characters).' }
  if (!isEncryptionAvailable()) {
    return {
      error:
        'This system has no OS credential store available, so the key cannot be stored securely. ' +
        'On Linux, install and unlock a keyring (gnome-keyring or kwallet) and restart the app.'
    }
  }
  try {
    const vault = readVault()
    vault[provider] = safeStorage.encryptString(key).toString('base64')
    writeVault(vault)
    return { error: null }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/**
 * Decrypt and return the key. **Main process only** — never return this over
 * IPC, and never log it.
 */
export function getKey(provider: string): string | null {
  if (!isEncryptionAvailable()) return null
  const blob = readVault()[provider]
  if (!blob) return null
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(blob, 'base64'))
    return decrypted.length > 0 ? decrypted : null
  } catch {
    // Wrong machine / rotated OS key / corrupt entry — treat as absent so the
    // user is prompted to re-enter rather than seeing an opaque crash.
    return null
  }
}

export function hasKey(provider: string): boolean {
  return getKey(provider) !== null
}

export function clearKey(provider: string): { error: null } {
  const vault = readVault()
  if (provider in vault) {
    delete vault[provider]
    try {
      if (Object.keys(vault).length === 0) {
        fs.rmSync(vaultPath(), { force: true })
      } else {
        writeVault(vault)
      }
    } catch {
      // Nothing actionable; the entry is gone from the in-memory copy and the
      // next successful write will drop it.
    }
  }
  return { error: null }
}

export interface CredentialStatus {
  /** Whether the OS can encrypt secrets at all. */
  available: boolean
  hasKey: boolean
  /** Last 4 characters of the stored key, for "is this the right key?" display. */
  hint: string | null
  error: string | null
}

/** Renderer-safe status. Computes the hint in main so the key never leaves. */
export function status(provider: string): CredentialStatus {
  const available = isEncryptionAvailable()
  if (!available) {
    return {
      available: false,
      hasKey: false,
      hint: null,
      error: 'No OS credential store is available on this system.'
    }
  }
  const key = getKey(provider)
  return {
    available: true,
    hasKey: key !== null,
    hint: key && key.length >= 4 ? key.slice(-4) : null,
    error: null
  }
}
