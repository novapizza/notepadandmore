import React, { useEffect, useState } from 'react'
import { Puzzle, RotateCw, Trash2, ExternalLink, Settings } from 'lucide-react'
import { usePluginStore, PluginDetail, PluginInfo } from '../../store/pluginStore'
import { useEditorStore } from '../../store/editorStore'
import { cn } from '../../lib/utils'

type DetailTab = 'details' | 'changelog'

export function PluginDetailTab({ pluginId }: { pluginId: string }) {
  const { plugins, fetchDetail, enablePlugin, disablePlugin, reloadPlugin, uninstallPlugin } = usePluginStore()
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('details')
  const [pendingAction, setPendingAction] = useState(false)

  const plugin = plugins.find((p) => p.name === pluginId)

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    fetchDetail(pluginId).then((d) => {
      if (d) {
        setDetail(d)
      } else {
        setNotFound(true)
      }
      setLoading(false)
    })
  }, [pluginId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (action: () => Promise<void>) => {
    setPendingAction(true)
    try {
      await action()
      // Refresh detail after action
      const d = await fetchDetail(pluginId)
      if (d) setDetail(d)
    } catch (err: any) {
      console.error(err)
    } finally {
      setPendingAction(false)
    }
  }

  const handleUninstall = async () => {
    const ok = await window.api.dialog.confirm(
      `Uninstall plugin "${pluginId}"?`,
      'This will remove all plugin files.',
      'Uninstall'
    )
    if (!ok) return
    setPendingAction(true)
    try {
      await uninstallPlugin(pluginId)
      // Tab will be closed by uninstallPlugin → closePluginDetailTab
    } catch (err: any) {
      console.error(err)
      setPendingAction(false)
    }
  }

  const openExtensionSettings = () => {
    useEditorStore.getState().openVirtualTab('settings')
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1 h-full items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm">Loading plugin details...</p>
      </div>
    )
  }

  if (notFound || !detail) {
    return (
      <div className="flex flex-col flex-1 h-full items-center justify-center bg-background" data-testid="plugin-not-found">
        <Puzzle size={48} className="text-muted-foreground/40 mb-4" />
        <h3 className="text-base font-medium text-foreground mb-1">Plugin not found</h3>
        <p className="text-sm text-muted-foreground mb-4">
          The plugin "{pluginId}" is no longer installed.
        </p>
        <button
          className="px-3 py-1.5 text-sm border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors"
          onClick={() => {
            useEditorStore.getState().closePluginDetailTab(pluginId)
          }}
        >
          Close Tab
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden bg-background" data-testid="plugin-detail-tab">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-start gap-4">
          {/* Icon */}
          {detail.iconDataUrl ? (
            <img src={detail.iconDataUrl} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Puzzle size={32} className="text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{detail.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground">v{detail.version}</span>
              {detail.author && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm text-muted-foreground">{detail.author}</span>
                </>
              )}
            </div>
            {detail.description && (
              <p className="text-sm text-muted-foreground mt-1">{detail.description}</p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              {plugin?.enabled ? (
                <ActionBtn label="Disable" onClick={() => handleAction(() => disablePlugin(pluginId))} disabled={pendingAction} />
              ) : (
                <ActionBtn label="Enable" onClick={() => handleAction(() => enablePlugin(pluginId))} disabled={pendingAction} />
              )}
              <button
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors disabled:opacity-40"
                onClick={() => handleAction(() => reloadPlugin(pluginId))}
                disabled={pendingAction || !plugin?.enabled}
                title="Reload"
              >
                <RotateCw size={12} />
                Reload
              </button>
              <button
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted hover:text-destructive transition-colors disabled:opacity-40"
                onClick={handleUninstall}
                disabled={pendingAction}
                title="Uninstall"
              >
                <Trash2 size={12} />
                Uninstall
              </button>
              {plugin?.hasSettings && (
                <button
                  className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors"
                  onClick={openExtensionSettings}
                  title="Extension Settings"
                >
                  <Settings size={12} />
                  Extension Settings
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-0 border-b border-border px-6">
        {(['details', 'changelog'] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            className={cn(
              'px-3 py-2 text-sm cursor-pointer bg-transparent border-none border-b-2 transition-colors',
              activeTab === tab
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 editor-scrollbar">
        {activeTab === 'details' && (
          <>
            {detail.readme ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none plugin-readme"
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(detail.readme) }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No README available.</p>
            )}
          </>
        )}

        {activeTab === 'changelog' && (
          <>
            {detail.changelog ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none plugin-readme"
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(detail.changelog) }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No changelog available.</p>
            )}
          </>
        )}

        {/* Metadata footer */}
        <div className="mt-6 pt-4 border-t border-border space-y-1">
          {detail.homepage && (
            <div className="flex items-center gap-1.5 text-sm">
              <ExternalLink size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground">Homepage:</span>
              <a
                href={detail.homepage}
                className="text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  window.open(detail.homepage!, '_blank')
                }}
              >
                {detail.homepage}
              </a>
            </div>
          )}
          {detail.license && (
            <div className="text-sm">
              <span className="text-muted-foreground">License:</span>{' '}
              <span className="text-foreground">{detail.license}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      className="px-2.5 py-1 text-xs border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

/** Simple markdown → HTML conversion (headings, bold, italic, code, links, lists, paragraphs). */
function simpleMarkdownToHtml(md: string): string {
  let html = md
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headings
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Unordered lists
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')

  // Wrap loose <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>')
  // Wrap in paragraph
  html = `<p>${html}</p>`
  // Clean empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')

  return html
}
