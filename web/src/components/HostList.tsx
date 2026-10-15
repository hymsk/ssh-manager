import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { HostCard } from './HostCard'
import { HostEditor } from './HostEditor'
import type { Host } from '../types'

interface Props {
  onOpenTerminal: (host: Host) => void
  onOpenHostExec: (host: Host) => void
}

type Filter = 'all' | 'online' | 'offline' | 'favorite'

export function HostList({ onOpenTerminal, onOpenHostExec }: Props) {
  const hosts = useStore((s) => s.hosts)
  const selected = useStore((s) => s.selectedHostIds)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const selectMany = useStore((s) => s.selectMany)
  const clearSelection = useStore((s) => s.clearSelection)
  const setPanel = useStore((s) => s.setPanel)
  const pushToast = useStore((s) => s.pushToast)
  const refreshHosts = useStore((s) => s.refreshHosts)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Host | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return hosts.filter((h) => {
      if (filter === 'online' && h.status !== 'online') return false
      if (filter === 'offline' && !['offline', 'unstable', 'timeout', 'auth_failed', 'error'].includes(h.status)) return false
      if (filter === 'favorite' && !h.favorite) return false
      if (!q) return true
      return (
        h.name.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        h.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [hosts, query, filter])

  const onlineIds = hosts.filter((h) => h.status === 'online').map((h) => h.id)
  const allVisibleSelected = filtered.length > 0 && filtered.every((h) => selected.includes(h.id))

  async function remove(host: Host) {
    if (!confirm(`确定删除主机「${host.name}」？此操作不可撤销。`)) return
    try {
      await api.deleteHost(host.id)
      pushToast('success', '已删除主机')
      await refreshHosts()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  async function probe(host: Host) {
    try {
      await api.probeHost(host.id)
      await refreshHosts()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h3>SSH 主机</h3>
        <span className="count">
          {filtered.length}/{hosts.length}
        </span>
        <span className="spacer" />
        <button
          className="btn sm primary"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          + 添加
        </button>
      </div>

      <div style={{ padding: '9px 10px 0' }}>
        <div className="search-box">
          <span className="ico">⌕</span>
          <input className="input" placeholder="搜索名称 / IP / 标签" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {(
            [
              ['all', '全部'],
              ['online', '在线'],
              ['offline', '异常'],
              ['favorite', '收藏'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} className={`btn sm ghost${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)} style={filter === key ? { background: 'var(--bg-3)', color: 'var(--text)' } : undefined}>
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="btn sm ghost"
            title="全选/取消"
            onClick={() => (allVisibleSelected ? clearSelection() : selectMany(filtered.map((h) => h.id)))}
          >
            {allVisibleSelected ? '取消' : '全选'}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {filtered.length === 0 && (
          <div className="empty">
            <div className="big">⌗</div>
            <div>{hosts.length === 0 ? '还没有主机，点击右上角添加' : '没有匹配的主机'}</div>
          </div>
        )}
        {filtered.map((host) => (
          <HostCard
            key={host.id}
            host={host}
            selected={selected.includes(host.id)}
            onToggleSelect={() => toggleSelect(host.id)}
            onTerminal={() => onOpenTerminal(host)}
            onExec={() => onOpenHostExec(host)}
            onEdit={() => {
              setEditing(host)
              setEditorOpen(true)
            }}
            onProbe={() => probe(host)}
            onDelete={() => remove(host)}
          />
        ))}
      </div>

      {selected.length > 0 && (
        <div className="selection-bar">
          <span style={{ fontSize: 12 }}>已选 {selected.length} 台</span>
          <span style={{ flex: 1 }} />
          <button
            className="btn sm"
            onClick={() => {
              const offline = selected.filter((id) => hosts.find((h) => h.id === id)?.status !== 'online').length
              if (offline) pushToast('warn', `${offline} 台离线主机将在执行时按策略跳过`)
              setPanel('batch')
            }}
          >
            批量执行
          </button>
          <button className="btn sm ghost" onClick={clearSelection}>
            取消
          </button>
        </div>
      )}

      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 8 }}>
        <button className="btn sm ghost" onClick={() => selectMany(onlineIds)} disabled={!onlineIds.length}>
          选中全部在线({onlineIds.length})
        </button>
      </div>

      {editorOpen && (
        <HostEditor host={editing} onClose={() => setEditorOpen(false)} onSaved={refreshHosts} />
      )}
    </>
  )
}
