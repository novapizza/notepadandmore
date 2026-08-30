import React, { useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useConfigStore, AppConfig } from '../../store/configStore'
import { cn } from '../../lib/utils'

/**
 * Settings → AI Assistant.
 *
 * The API key field is **write-only**. `window.api.ai` deliberately exposes no
 * getter, so once a key is stored this UI can only report that one exists plus
 * its last four characters — enough to answer "is this the right key?" without
 * the plaintext ever re-entering the renderer.
 */

const inputCls =
  'bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-ring'

interface KeyStatus {
  available: boolean
  hasKey: boolean
  hint: string | null
  defaultModels: string[]
  error: string | null
}

export function AiSection(): React.ReactElement {
  const config = useConfigStore()
  const set = <K extends keyof AppConfig>(key: K, val: AppConfig[K]): void => config.setProp(key, val)

  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [revealDraft, setRevealDraft] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [liveModels, setLiveModels] = useState<string[]>([])

  const refresh = async (): Promise<void> => {
    const s = await window.api.ai.status(config.aiProvider)
    setStatus(s)
    setEditing(!s.hasKey)
  }

  useEffect(() => {
    void refresh()
  }, [config.aiProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveKey = async (): Promise<void> => {
    const key = draftKey.trim()
    if (!key) return
    setSaving(true)
    setSaveError(null)
    const res = await window.api.ai.setKey(config.aiProvider, key)
    setSaving(false)
    if (res.error) {
      setSaveError(res.error)
      return
    }
    setDraftKey('')
    setRevealDraft(false)
    setTestResult(null)
    await refresh()
    // A newly stored key is worth validating straight away — cheaper than
    // discovering it is wrong on the first real question.
    void runTest()
  }

  const removeKey = async (): Promise<void> => {
    const ok = await window.api.dialog.confirm(
      'Remove the stored API key?',
      'The assistant will stop working until you enter a key again.',
      'Remove'
    )
    if (!ok) return
    await window.api.ai.clearKey(config.aiProvider)
    setTestResult(null)
    setLiveModels([])
    await refresh()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const res = await window.api.ai.test(config.aiProvider)
    setTesting(false)
    if (!res.ok) {
      setTestResult({ ok: false, message: res.error ?? 'The connection test failed.' })
      return
    }
    setLiveModels(res.models)
    setTestResult({
      ok: true,
      message: `Key is valid — ${res.models.length} model${res.models.length === 1 ? '' : 's'} available.`
    })
    // If the configured model isn't in the account's list, say so rather than
    // letting the first real request fail with a bare 404.
    if (res.models.length > 0 && !res.models.includes(config.aiModel)) {
      const fallback = res.models.find((m) => m.includes('flash')) ?? res.models[0]
      setTestResult({
        ok: true,
        message: `Key is valid, but "${config.aiModel}" isn't available to it. Switched to "${fallback}".`
      })
      set('aiModel', fallback)
    }
  }

  const modelOptions = liveModels.length > 0 ? liveModels : status?.defaultModels ?? []
  // "Custom" mode swaps the dropdown for a free-text field, for model ids that
  // aren't in the suggestion list yet (Google ships new ids constantly).
  const [customModel, setCustomModel] = useState(false)
  // The dropdown must always display the configured value, even one that came
  // from an older default list or was typed in custom mode.
  const selectOptions =
    config.aiModel && !modelOptions.includes(config.aiModel)
      ? [config.aiModel, ...modelOptions]
      : modelOptions

  return (
    <div className="flex max-w-[560px] flex-col gap-4">
      {/* Master switch */}
      <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
        <input
          type="checkbox"
          checked={config.aiEnabled}
          onChange={(e) => set('aiEnabled', e.target.checked)}
          className="accent-primary"
          data-testid="ai-enabled-toggle"
        />
        <span>Enable the AI assistant</span>
      </label>
      <p className="-mt-3 text-xs text-muted-foreground">
        Off by default. Nothing is sent anywhere until you turn this on, add a key, and ask
        a question.
      </p>

      {/* Platform capability warning */}
      {status && !status.available && (
        <Callout tone="warn">
          <strong>No credential store available.</strong> This system has no OS keychain for
          NovaPad to encrypt secrets with, so an API key cannot be stored safely and the
          assistant is unavailable. On Linux, install and unlock gnome-keyring or kwallet, then
          restart NovaPad.
        </Callout>
      )}

      {/* API key */}
      <div className="border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Google Gemini API key</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Create one in Google AI Studio. It is encrypted with your operating system&apos;s
          credential store and handled only by NovaPad&apos;s background process — it is never
          written to <span className="font-mono">config.json</span> and never exposed to the
          editor UI.
        </p>

        {status?.hasKey && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-1 text-sm">
              <ShieldCheck size={14} className="text-green-500" />
              <span className="font-mono text-muted-foreground">
                {'•'.repeat(12)}
                {status.hint ?? ''}
              </span>
            </span>
            <button
              className="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground hover:bg-secondary"
              onClick={() => {
                setEditing(true)
                setDraftKey('')
              }}
            >
              Replace
            </button>
            <button
              className="flex cursor-pointer items-center gap-1 rounded border border-border bg-transparent px-2 py-1 text-sm text-destructive hover:bg-destructive/10"
              onClick={() => void removeKey()}
            >
              <Trash2 size={13} /> Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <input
                type={revealDraft ? 'text' : 'password'}
                className={cn(inputCls, 'w-full pr-8 font-mono')}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveKey()
                }}
                placeholder="Paste your API key"
                autoComplete="off"
                spellCheck={false}
                disabled={status ? !status.available : false}
                data-testid="ai-key-input"
              />
              <button
                type="button"
                title={revealDraft ? 'Hide' : 'Show'}
                onClick={() => setRevealDraft((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0.5 text-muted-foreground hover:text-foreground"
              >
                {revealDraft ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              className={cn(
                'rounded border-none bg-primary px-3 py-1 text-sm text-primary-foreground',
                draftKey.trim() && !saving ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-50'
              )}
              disabled={!draftKey.trim() || saving}
              onClick={() => void saveKey()}
              data-testid="ai-key-save"
            >
              {saving ? 'Saving…' : 'Save key'}
            </button>
            {status?.hasKey && (
              <button
                className="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  setEditing(false)
                  setDraftKey('')
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {saveError && <Callout tone="error">{saveError}</Callout>}

        {/* Test connection */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={cn(
              'flex items-center gap-1.5 rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground',
              status?.hasKey && !testing ? 'cursor-pointer hover:bg-secondary' : 'cursor-not-allowed opacity-50'
            )}
            disabled={!status?.hasKey || testing}
            onClick={() => void runTest()}
            data-testid="ai-test-connection"
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span
              className={cn('text-xs', testResult.ok ? 'text-green-500' : 'text-destructive')}
              data-testid="ai-test-result"
            >
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      {/* Model + behaviour */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Model &amp; behaviour</h3>

        <Row label="Model">
          {customModel ? (
            <input
              className={cn(inputCls, 'max-w-[260px] font-mono')}
              value={config.aiModel}
              onChange={(e) => set('aiModel', e.target.value)}
              placeholder="gemini-3.5-flash"
              autoFocus
              spellCheck={false}
              data-testid="ai-model-input"
            />
          ) : (
            <select
              className={cn(inputCls, 'max-w-[260px] font-mono cursor-pointer')}
              value={config.aiModel}
              onChange={(e) => set('aiModel', e.target.value)}
              data-testid="ai-model-select"
            >
              {selectOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button
            className="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setCustomModel((v) => !v)}
            title={customModel ? 'Pick from the suggested Gemini models' : 'Type a model id not in the list'}
          >
            {customModel ? 'Choose from list' : 'Custom…'}
          </button>
        </Row>
        <p className="-mt-1 ml-[136px] text-xs text-muted-foreground">
          Flash models are the fast, low-cost choice for document work.{' '}
          {liveModels.length === 0 && 'Run Test connection to list the models your key can use.'}
        </p>

        <Row label="Default context">
          <select
            className={cn(inputCls, 'max-w-[240px]')}
            value={config.aiDefaultContext}
            onChange={(e) => set('aiDefaultContext', e.target.value as AppConfig['aiDefaultContext'])}
          >
            <option value="auto">Selection if any, else whole file</option>
            <option value="selection">Selection only</option>
            <option value="document">Whole file</option>
            <option value="none">Nothing (prompt only)</option>
          </select>
        </Row>

        <Row label="Context limit">
          <input
            type="number"
            min={1}
            max={400}
            step={10}
            className={cn(inputCls, 'w-[80px]')}
            value={Math.round(config.aiMaxContextChars / 1000)}
            onChange={(e) =>
              set('aiMaxContextChars', Math.min(400, Math.max(1, parseInt(e.target.value) || 200)) * 1000)
            }
          />
          <span className="ml-1 text-sm text-muted-foreground">thousand characters</span>
        </Row>
        <p className="-mt-1 ml-[136px] text-xs text-muted-foreground">
          Longer context costs more and takes longer. Text beyond the limit is cut, and the chat
          tells you when that happened.
        </p>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={config.aiShowBadge}
            onChange={(e) => set('aiShowBadge', e.target.checked)}
            className="accent-primary"
          />
          <span>Show the Gemini badge in the bottom-right of the editor</span>
        </label>
      </div>

      {/* Privacy */}
      <Callout tone="info">
        <strong>What gets sent.</strong> When you ask a question, your prompt plus the document
        text shown in the chat&apos;s context chip is sent to Google&apos;s Generative Language
        API. The file name and language go with it; the full path does not. Conversations are
        kept in memory only and are discarded when NovaPad closes. Review Google&apos;s API terms
        for how they handle the data.
      </Callout>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <label className="w-32 shrink-0 text-sm text-muted-foreground">{label}</label>
      <div className="flex flex-1 items-center gap-1">{children}</div>
    </div>
  )
}

function Callout({
  tone,
  children
}: {
  tone: 'info' | 'warn' | 'error'
  children: React.ReactNode
}): React.ReactElement {
  const styles = {
    info: 'border-border bg-secondary/40 text-muted-foreground',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    error: 'border-destructive/40 bg-destructive/10 text-destructive'
  }[tone]
  return (
    <div className={cn('mt-2 flex items-start gap-2 rounded border px-2.5 py-2 text-xs leading-relaxed', styles)}>
      {tone !== 'info' && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  )
}
