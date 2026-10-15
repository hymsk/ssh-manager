import type { Host } from '../types'
import { StatusDot } from './StatusDot'
import { formatRelative } from '../lib/format'

interface Props {
  host: Host
  selected: boolean
  onToggleSelect: () => void
  onTerminal: () => void
  onExec: () => void
  onEdit: () => void
  onProbe: () => void
  onDelete: () => void
}

export function HostCard({
  host,
  selected,
  onToggleSelect,
  onTerminal,
  onExec,
  onEdit,
  onProbe,
  onDelete,
}: Props) {
  return (
    <div className={`host-card${selected ? ' selected' : ''}${host.status === 'error' ? ' status-error' : ''}`}>
      <div className="check">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          title="选择用于批量执行"
          style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
        />
      </div>

      <div className="row1" style={{ paddingRight: 22 }}>
        <span className="name" title={host.name}>
          {host.favorite ? '★ ' : ''}
          {host.name}
        </span>
      </div>

      <div className="addr">
        {host.username}@{host.host}:{host.port}
      </div>

      <div className="meta">
        <StatusDot status={host.status} kind="host" />
        {host.latencyMs != null && <span>{host.latencyMs} ms</span>}
        {host.lastCheckedAt && <span>探测于 {formatRelative(host.lastCheckedAt)}</span>}
        {host.consecutiveFailures > 0 && <span>连续失败 {host.consecutiveFailures} 次</span>}
      </div>

      {host.tags.length > 0 && (
        <div className="tags">
          {host.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      {host.lastError && <div className="err">{host.lastError}</div>}

      <div className="actions">
        <button className="btn sm ghost" onClick={onTerminal} title="打开 SSH 终端">
          终端
        </button>
        <button className="btn sm ghost" onClick={onExec} title="对当前主机执行命令">
          执行
        </button>
        <button className="btn sm ghost" onClick={onEdit} title="编辑配置">
          配置
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={onProbe} title="立即探测">
          ⟳
        </button>
        <button className="btn sm ghost danger" onClick={onDelete} title="删除主机">
          ✕
        </button>
      </div>
    </div>
  )
}
