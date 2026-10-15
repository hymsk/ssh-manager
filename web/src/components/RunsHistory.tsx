import { useEffect } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { StatusDot } from './StatusDot'

function runStatusKind(status: string): 'running' | 'success' | 'failed' | 'cancelled' {
  if (status === 'running') return 'running'
  if (status === 'success') return 'success'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

export function RunsHistory() {
  const runs = useStore((s) => s.runs)
  const refreshRuns = useStore((s) => s.refreshRuns)
  const loadRun = useStore((s) => s.loadRun)
  const pushToast = useStore((s) => s.pushToast)

  useEffect(() => {
    refreshRuns()
  }, [refreshRuns])

  async function clearAll() {
    if (!confirm('确定清空所有执行记录？')) return
    try {
      await api.clearRuns()
      await refreshRuns()
      pushToast('success', '已清空执行记录')
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h3>执行记录</h3>
        <span className="count">{runs.length}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={refreshRuns}>
          刷新
        </button>
        <button className="btn sm ghost danger" onClick={clearAll}>
          清空
        </button>
      </div>
      <div className="panel-body no-pad" style={{ overflowX: 'auto' }}>
        {runs.length === 0 && (
          <div className="empty">
            <div className="big">⧉</div>
            <div>暂无执行记录</div>
          </div>
        )}
        {runs.length > 0 && (
          <table className="runs-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>成功/失败</th>
                <th>开始时间</th>
                <th>触发</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => loadRun(r.id)}>
                  <td>
                    {r.name}
                    {r.plan_id && (
                      <span className="tag" style={{ marginLeft: 6 }}>
                        计划
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusDot status={runStatusKind(r.status)} kind="result" />
                  </td>
                  <td>
                    <span style={{ color: 'var(--green)' }}>{r.success_count}</span> /{' '}
                    <span style={{ color: r.failed_count ? 'var(--red)' : 'var(--text-dim)' }}>{r.failed_count}</span>
                  </td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>{formatDateTime(r.started_at)}</td>
                  <td style={{ color: 'var(--text-faint)', fontSize: 11 }}>{r.trigger}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
