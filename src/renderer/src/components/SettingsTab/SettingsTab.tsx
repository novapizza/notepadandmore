import React, { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useConfigStore, AppConfig } from '../../store/configStore'
import { usePluginStore, PluginSettingField } from '../../store/pluginStore'
import { cn } from '../../lib/utils'
import { ShortcutsSection } from './ShortcutsSection'
import { AiSection } from './AiSection'
import { ThemeGallery } from './ThemeGallery'
import { ThemeDrawer } from './ThemeDrawer'
import { useAltHeld } from '../../hooks/useAltHeld'
import { useAltMnemonics, MnemonicHandlers } from '../../hooks/useAltMnemonics'
import { MnemonicLabel, parseMnemonic } from '../../utils/mnemonic'
import { isWindows } from '../../utils/platform'

type PrefTab = 'general' | 'editor' | 'appearance' | 'newDoc' | 'backup' | 'completion' | 'shortcuts' | 'ai' | 'extensions'

const STATIC_TABS: { id: PrefTab; label: string }[] = [
  { id: 'general',    label: '&General' },
  { id: 'editor',     label: '&Editor' },
  { id: 'appearance', label: '&Appearance' },
  { id: 'newDoc',     label: '&New Document' },
  { id: 'backup',     label: '&Backup / AutoSave' },
  { id: 'completion', label: 'Auto-&Completion' },
  { id: 'shortcuts',  label: '&Keyboard Shortcuts' },
  // Mnemonic I, not A — &A is taken by Appearance.
  { id: 'ai',         label: 'A&I Assistant' },
]

const ENCODINGS = [
  'UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE',
  'Windows-1252', 'ISO-8859-1', 'ASCII'
]

const MONO_FONTS = [
  "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  "Consolas, 'Courier New', monospace",
  "'Fira Code', monospace",
  "'JetBrains Mono', monospace",
  "'Source Code Pro', monospace",
  "monospace",
]

const inputCls = "bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-ring"

export function SettingsTab() {
  const config = useConfigStore()
  const { plugins, pluginSettings, pluginConfigs, fetchPluginSettings, setPluginConfig } = usePluginStore()
  const pendingCategory = useUIStore((s) => s.pendingSettingsCategory)
  const setPendingCategory = useUIStore((s) => s.setPendingSettingsCategory)
  // Active category lives in the store, not local state, so it survives the
  // SettingsTab unmounting when the user switches to another tab and back.
  const activeTab = useUIStore((s) => s.settingsCategory) as PrefTab
  const setActiveTab = useUIStore((s) => s.setSettingsCategory)

  // Fetch plugin settings schemas on mount
  useEffect(() => {
    fetchPluginSettings()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link consumer: when something asked to open Settings at a specific
  // category (e.g. the gear menu's "Keyboard Shortcuts" entry), apply it and
  // clear the pending flag.
  useEffect(() => {
    if (!pendingCategory) return
    setActiveTab(pendingCategory as PrefTab)
    setPendingCategory(null)
  }, [pendingCategory, setPendingCategory])

  // Build dynamic tabs — add Extensions only if any enabled plugin has settings
  const enabledPluginNames = new Set(plugins.filter((p) => p.enabled).map((p) => p.name))
  const activePluginSettings = Object.entries(pluginSettings).filter(([name]) => enabledPluginNames.has(name))
  const hasExtensions = activePluginSettings.length > 0
  const TABS = hasExtensions
    ? [...STATIC_TABS, { id: 'extensions' as PrefTab, label: 'E&xtensions' }]
    : STATIC_TABS

  const altHeld = useAltHeld()

  const tabHandlers: MnemonicHandlers = (() => {
    const h: MnemonicHandlers = {}
    for (const t of TABS) {
      const { letter } = parseMnemonic(t.label)
      if (letter && !(letter in h)) h[letter] = () => setActiveTab(t.id)
    }
    return h
  })()
  useAltMnemonics(isWindows(), tabHandlers, { allowInsideInputs: true, priority: true })

  const set = <K extends keyof AppConfig>(key: K, val: AppConfig[K]) => config.setProp(key, val)

  // Theme picker drawer (slides in on the left of the Settings row, pushing the
  // category list right). Local + ephemeral — closes when leaving Settings.
  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false)

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden bg-background" data-testid="settings-tab">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Changes are saved automatically.</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Theme picker drawer — pushes the category list right when open */}
        {themeDrawerOpen && (
          <ThemeDrawer
            value={config.theme}
            onSelect={(t) => { useUIStore.getState().setTheme(t); set('theme', t) }}
            onClose={() => setThemeDrawerOpen(false)}
          />
        )}
        {/* Category list */}
        <div className="w-[160px] border-r border-border shrink-0 py-2 overflow-y-auto editor-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm cursor-pointer bg-transparent border-none text-foreground transition-colors hover:bg-secondary',
                activeTab === t.id && 'bg-primary/15 text-primary font-medium'
              )}
              onClick={() => { setActiveTab(t.id); setThemeDrawerOpen(false) }}
              data-testid={`settings-category-${t.id}`}
            >
              <MnemonicLabel label={t.label} show={altHeld} />
            </button>
          ))}
        </div>

        {/* Category content */}
        <div className="flex-1 overflow-y-auto p-4 editor-scrollbar">
          {activeTab === 'general' && (
            <div className="flex flex-col gap-3 max-w-[520px]">
              <Row label="Max recent files">
                <input type="number" min={1} max={50} className={cn(inputCls, 'w-[72px]')} value={config.maxRecentFiles} onChange={(e) => set('maxRecentFiles', Math.max(1, parseInt(e.target.value) || 1))} />
              </Row>
              <Row label="UI Language">
                <select className={cn(inputCls, 'max-w-[200px]')} value={config.language} onChange={(e) => set('language', e.target.value)}>
                  <option value="en">English</option>
                </select>
              </Row>
            </div>
          )}

          {activeTab === 'editor' && (
            <div className="flex flex-col gap-3 max-w-[520px]">
              <Row label="Font family">
                <select className={cn(inputCls, 'max-w-[260px]')} value={config.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>
                  {MONO_FONTS.map((f) => (<option key={f} value={f}>{f.split(',')[0].replace(/'/g, '')}</option>))}
                </select>
              </Row>
              <Row label="Font size">
                <input type="number" min={8} max={32} className={cn(inputCls, 'w-[72px]')} value={config.fontSize} onChange={(e) => set('fontSize', Math.max(8, parseInt(e.target.value) || 14))} />
                <span className="text-sm text-muted-foreground ml-1">px</span>
              </Row>
              <Row label="Tab size">
                <input type="number" min={1} max={16} className={cn(inputCls, 'w-[72px]')} value={config.tabSize} onChange={(e) => set('tabSize', Math.max(1, parseInt(e.target.value) || 4))} />
              </Row>
              <CheckRow label="Insert spaces (not tabs)" checked={config.insertSpaces} onChange={(v) => set('insertSpaces', v)} />
              <CheckRow label="Word wrap" checked={config.wordWrap} onChange={(v) => set('wordWrap', v)} />
              <CheckRow label="Auto word wrap on long lines" checked={config.autoWrapLongLines} onChange={(v) => set('autoWrapLongLines', v)} />
              <CheckRow label="Show line numbers" checked={config.showLineNumbers} onChange={(v) => set('showLineNumbers', v)} />
              <CheckRow label="Highlight current line" checked={config.highlightCurrentLine} onChange={(v) => set('highlightCurrentLine', v)} />
              <CheckRow label="Render indentation guides" checked={config.renderIndentGuides} onChange={(v) => set('renderIndentGuides', v)} />
              <CheckRow label="Bracket pair colorization" checked={config.bracketPairColorization} onChange={(v) => set('bracketPairColorization', v)} />
              <CheckRow label="Show minimap" checked={config.showMinimap} onChange={(v) => set('showMinimap', v)} />
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="flex flex-col gap-5 max-w-[520px]">
              <ThemeGallery value={config.theme} onOpen={() => setThemeDrawerOpen(true)} />
              <Row label="Render whitespace">
                <select className={cn(inputCls, 'max-w-[200px]')} value={config.renderWhitespace} onChange={(e) => set('renderWhitespace', e.target.value as AppConfig['renderWhitespace'])}>
                  <option value="none">None</option>
                  <option value="boundary">Boundary</option>
                  <option value="all">All</option>
                </select>
              </Row>
            </div>
          )}

          {activeTab === 'newDoc' && (
            <div className="flex flex-col gap-3 max-w-[520px]">
              <Row label="Default EOL">
                <select className={cn(inputCls, 'max-w-[200px]')} value={config.defaultEol} onChange={(e) => set('defaultEol', e.target.value as AppConfig['defaultEol'])}>
                  <option value="LF">LF (Unix/macOS)</option>
                  <option value="CRLF">CRLF (Windows)</option>
                  <option value="CR">CR (old macOS)</option>
                </select>
              </Row>
              <Row label="Default encoding">
                <select className={cn(inputCls, 'max-w-[200px]')} value={config.defaultEncoding} onChange={(e) => set('defaultEncoding', e.target.value)}>
                  {ENCODINGS.map((enc) => <option key={enc} value={enc}>{enc}</option>)}
                </select>
              </Row>
              <Row label="Default language">
                <input type="text" className={cn(inputCls, 'max-w-[200px]')} value={config.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} placeholder="plaintext" />
              </Row>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="flex flex-col gap-3 max-w-[520px]">
              <CheckRow label="Enable AutoSave" checked={config.autoSaveEnabled} onChange={(v) => set('autoSaveEnabled', v)} />
              {config.autoSaveEnabled && (
                <Row label="AutoSave interval">
                  <input type="number" min={5} max={600} step={5} className={cn(inputCls, 'w-[72px]')} value={config.autoSaveIntervalMs / 1000} onChange={(e) => set('autoSaveIntervalMs', Math.max(5, parseInt(e.target.value) || 60) * 1000)} />
                  <span className="text-sm text-muted-foreground ml-1">seconds</span>
                </Row>
              )}
              <CheckRow label="Enable file backup on save" checked={config.backupEnabled} onChange={(v) => set('backupEnabled', v)} />
              {config.backupEnabled && (
                <Row label="Backup directory">
                  <input type="text" className={cn(inputCls, 'flex-1')} value={config.backupDir} onChange={(e) => set('backupDir', e.target.value)} placeholder="Leave empty for default" />
                </Row>
              )}
              <div className="border-t border-border pt-3 mt-1" />
              <CheckRow
                label="Remember unsaved changes on exit (Notepad++ snapshot)"
                checked={config.rememberUnsavedOnExit}
                onChange={(v) => set('rememberUnsavedOnExit', v)}
              />
              {config.rememberUnsavedOnExit && (
                <Row label="Snapshot interval">
                  <input
                    type="number"
                    min={1}
                    max={600}
                    step={1}
                    className={cn(inputCls, 'w-[72px]')}
                    value={Math.max(1, Math.round(config.snapshotIntervalMs / 1000))}
                    onChange={(e) =>
                      set(
                        'snapshotIntervalMs',
                        Math.max(1, parseInt(e.target.value) || 7) * 1000
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground ml-1">seconds</span>
                </Row>
              )}
              <p className="text-xs text-muted-foreground -mt-1">
                Closes the app without prompting for unsaved changes; restores
                untitled and dirty files on next launch from{' '}
                <code className="text-foreground/80">{'%APPDATA%\\<app>\\backup\\'}</code>.
              </p>
            </div>
          )}

          {activeTab === 'completion' && (
            <div className="flex flex-col gap-3 max-w-[520px]">
              <CheckRow label="Enable auto-complete suggestions" checked={config.autoCompleteEnabled} onChange={(v) => set('autoCompleteEnabled', v)} />
              <CheckRow label="Auto-close brackets" checked={config.autoCloseBrackets} onChange={(v) => set('autoCloseBrackets', v)} />
              <CheckRow label="Auto-close quotes" checked={config.autoCloseQuotes} onChange={(v) => set('autoCloseQuotes', v)} />
              <CheckRow label="Word-based suggestions" checked={config.wordBasedSuggestions} onChange={(v) => set('wordBasedSuggestions', v)} />
            </div>
          )}

          {activeTab === 'shortcuts' && <ShortcutsSection />}

          {activeTab === 'ai' && <AiSection />}

          {activeTab === 'extensions' && (
            <div className="flex flex-col gap-6 max-w-[520px]">
              {activePluginSettings.map(([pluginName, schema]) => (
                <div key={pluginName}>
                  <h3 className="text-sm font-semibold text-foreground mb-3 pb-1 border-b border-border">
                    {pluginName}
                  </h3>
                  <div className="flex flex-col gap-3">
                    {schema.fields.map((field) => (
                      <PluginSettingRow
                        key={`${pluginName}-${field.key}`}
                        field={field}
                        value={pluginConfigs[pluginName]?.[field.key] ?? field.default}
                        onChange={(val) => setPluginConfig(pluginName, field.key, val)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground w-32 shrink-0">{label}</label>
      <div className="flex items-center gap-1 flex-1">{children}</div>
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      <span>{label}</span>
    </label>
  )
}

function PluginSettingRow({ field, value, onChange }: { field: PluginSettingField; value: unknown; onChange: (val: unknown) => void }) {
  if (field.type === 'boolean') {
    return (
      <div>
        <CheckRow
          label={field.label}
          checked={value as boolean ?? field.default as boolean}
          onChange={(v) => onChange(v)}
        />
        {field.description && <p className="text-xs text-muted-foreground mt-0.5 ml-5">{field.description}</p>}
      </div>
    )
  }

  return (
    <div>
      <Row label={field.label}>
        {field.type === 'string' && (
          <input
            type="text"
            className={cn(inputCls, 'flex-1')}
            value={(value as string) ?? (field.default as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {field.type === 'number' && (
          <input
            type="number"
            className={cn(inputCls, 'w-[100px]')}
            min={field.min}
            max={field.max}
            value={(value as number) ?? (field.default as number) ?? 0}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          />
        )}
        {field.type === 'select' && (
          <select
            className={cn(inputCls, 'max-w-[200px]')}
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
            ))}
          </select>
        )}
      </Row>
      {field.description && <p className="text-xs text-muted-foreground mt-0.5 ml-[136px]">{field.description}</p>}
    </div>
  )
}
