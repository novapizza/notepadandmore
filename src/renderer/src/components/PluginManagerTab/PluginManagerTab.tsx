import React, { useEffect, useState } from 'react'
import { Search, Puzzle, FolderOpen, RotateCw, Trash2, AlertTriangle } from 'lucide-react'
import { usePluginStore, PluginInfo } from '../../store/pluginStore'
import { useEditorStore } from '../../store/editorStore'
import { cn } from '../../lib/utils'

type FilterTab = 'all' | 'enabled' | 'disabled'

export function PluginManagerTab() {
  const { plugins, fetchPlugins, enablePlugin, disablePlugin, reloadPlugin, installPlugin, uninstallPlugin } = usePluginStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  useEffect(() => {
    fetchPlugins()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = plugins.filter((p) => {
    // Status filter
    if (filter === 'enabled' && !p.enabled) return false
    if (filter === 'disabled' && p.enabled) return false

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.author?.toLowerCase().includes(q) ?? false) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  const handleAction = async (action: () => Promise<void>, pluginName: string) => {
    setPendingAction(pluginName)
    try {
      await action()
    } catch (err: any) {
      console.error(err)
    } finally {
      setPendingAction(null)
    }
  }

  const handleUninstall = async (name: string) => {
    const ok = await window.api.dialog.confirm(
      `Uninstall plugin "${name}"?`,
      'This will remove all plugin files.',
      'Uninstall'
    )
    if (!ok) return
    await handleAction(() => uninstallPlugin(name), name)
  }

  const openDetail = (plugin: PluginInfo) => {
    useEditorStore.getState().openPluginDetailTab(plugin.name, plugin.name)
  }

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden bg-background" data-testid="plugin-manager-tab">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Extensions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage installed plugins.</p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors"
          onClick={() => handleAction(() => installPlugin().then(() => {}), '__install')}
          data-testid="plugin-install-btn"
        >
          <FolderOpen size={14} />
          Install Plugin...
        </button>
      </div>

      {/* Search + Filter */}
      <div className="px-4 py-2 border-b border-border space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search extensions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-input border border-border rounded pl-8 pr-3 py-1.5 text-sm text-foreground outline-none focus:border-ring"
            data-testid="plugin-search"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'enabled', 'disabled'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              className={cn(
                'px-2.5 py-1 text-xs rounded cursor-pointer bg-transparent border-none transition-colors',
                filter === tab
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary'
              )}
              onClick={() => setFilter(tab)}
              data-testid={`plugin-filter-${tab}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin List */}
      <div className="flex-1 overflow-y-auto editor-scrollbar">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm" data-testid="plugin-empty-state">
            {plugins.length === 0 ? (
              <>
                <Puzzle size={32} className="mx-auto mb-3 opacity-40" />
                <p>No plugins installed.</p>
                <p className="mt-1">Click "Install from Folder" to add one.</p>
              </>
            ) : (
              <p>No plugins match your search.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((p) => (
              <PluginRow
                key={p.name}
                plugin={p}
                isPending={pendingAction === p.name}
                onOpenDetail={() => openDetail(p)}
                onEnable={() => handleAction(() => enablePlugin(p.name), p.name)}
                onDisable={() => handleAction(() => disablePlugin(p.name), p.name)}
                onReload={() => handleAction(() => reloadPlugin(p.name), p.name)}
                onUninstall={() => handleUninstall(p.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PluginRow({
  plugin,
  isPending,
  onOpenDetail,
  onEnable,
  onDisable,
  onReload,
  onUninstall
}: {
  plugin: PluginInfo
  isPending: boolean
  onOpenDetail: () => void
  onEnable: () => void
  onDisable: () => void
  onReload: () => void
  onUninstall: () => void
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors group"
      data-testid={`plugin-row-${plugin.name}`}
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Puzzle size={20} className="text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            className="text-sm font-medium text-foreground hover:text-primary cursor-pointer bg-transparent border-none p-0 text-left"
            onClick={onOpenDetail}
            title="View details"
          >
            {plugin.name}
          </button>
          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
          {plugin.error && (
            <span className="flex items-center gap-1 text-xs text-destructive" title={plugin.error}>
              <AlertTriangle size={12} />
              Error
            </span>
          )}
        </div>
        {plugin.author && (
          <span className="text-xs text-muted-foreground">{plugin.author}</span>
        )}
        {plugin.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{plugin.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {plugin.enabled ? (
          <ActionBtn label="Disable" onClick={onDisable} disabled={isPending} />
        ) : (
          <ActionBtn label="Enable" onClick={onEnable} disabled={isPending} />
        )}
        <button
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none disabled:opacity-40"
          onClick={onReload}
          disabled={isPending || !plugin.enabled}
          title="Reload"
        >
          <RotateCw size={14} />
        </button>
        <button
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer bg-transparent border-none disabled:opacity-40"
          onClick={onUninstall}
          disabled={isPending}
          title="Uninstall"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function ActionBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      className="px-2 py-0.5 text-xs border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
