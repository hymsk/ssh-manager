import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { StatusDot } from './StatusDot'
import { formatDateTime, formatDuration, RUN_STATUS_LABEL, csvCell } from '../lib/format'
import type { ResultStatus, RunResult } from '../types'

type Filter = 'all' | 'success' | 'failed' | 'running' | 'pending'

const FAIL: ResultStatus[] = ['failed', 'timeout', 'auth_failed', 'disconnected', 'offline', 'error']
const RUNNING: ResultStatus[] = ['connecting', 'running']

export function RunView() {
  const run = useStore((s) => s.activeRun)
  const results = useStore((s) => s.runResults)
  const cancel = useStore((s) => s.cancelActiveRun)
  const retryFailed = useStore((s) => s.retryFailed)
  const retryHost = useStore((s) => s.retryHost)
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => Object.values(results), [results])
  const counts = useMemo(() => {
    const c = { success: 0, failed: 0, running: 0, pending: 0, skipped: 0 }
    for (const r of rows) {
      if (r.status === 'success') c.success += 1
      else if (FAIL.includes(r.status)) c.failed += 1
      else if (RUNNING.includes(r.status) || r.status === 'cancelled') c.running += 1
      else if (r.status === 'skipped') c.skipped += 1
      else c.pending += 1
    }
    return c
  }, [rows])

  const filtered = useMemo(() => {
    switch (filter) {
      case 'success':
        return rows.filter((r) => r.status === 'success')
      case 'failed':
        return rows.filter((r) => FAIL.includes(r.status))
      case 'running':
        return rows.filter((r) => RUNNING.includes(r.status))
      case 'pending':
        return rows.filter((r) => r.status === 'pending' || r.status === 'skipped')
      default:
        return rows
    }
  }, [rows, filter])

  if (!run) {
    return (
      <div className="empty">
        <div className="big">▤</div>
        <div>暂无执行任务</div>
        <div style={{ fontSize: 12 }}>在左侧勾选主机后点击「批量执行」</div>
      </div>
    )
  }

  const running = run.status === 'running'
  const currentRun = run

  function exportCsv() {
    const header = ['主机', '状态', '退出码', '耗时(ms)', '重试', '标准输出', '错误输出', '错误信息']
    const lines = [header.map(csvCell).join(',')]
    for (const r of rows) {
      lines.push(
        [r.host_name, r.status, r.exit_code, r.duration_ms, r.retry_count, r.stdout, r.stderr, r.error_message]
          .map(csvCell)
          .join(','),
      )
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentRun.name}-${currentRun.started_at.slice(0, 19).replace(/[:T]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div className="section" style={{ margin: 12 }}>
        <div className="section-head">
          <span>{run.name}</span>
          <StatusDot status={run.status === 'running' ? 'running' : run.status === 'success' ? 'success' : run.status === 'cancelled' ? 'cancelled' : 'failed'} kind="result" />
          <span className="spacer" />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {formatDateTime(run.started_at)}
          </span>
        </div>

        <div className="summary">
          <div className="chip">
            <span className="n">{run.total_hosts}</span>
            <span className="l">总计</span>
          </div>
          <div className="chip">
            <span className="n" style={{ color: 'var(--green)' }}>{counts.success}</span>
            <span className="l">成功</span>
          </div>
          <div className="chip">
            <span className="n" style={{ color: 'var(--red)' }}>{counts.failed}</span>
            <span className="l">失败</span>
          </div>
          <div className="chip">
            <span className="n" style={{ color: 'var(--accent)' }}>{counts.running}</span>
            <span className="l">执行中</span>
          </div>
          <div className="chip">
            <span className="n">{counts.pending}</span>
            <span className="l">等待</span>
          </div>
          {counts.skipped > 0 && (
            <div className="chip">
              <span className="n" style={{ color: 'var(--orange)' }}>{counts.skipped}</span>
              <span className="l">跳过</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px', flexWrap: 'wrap' }}>
          {(
            [
              ['all', '全部'],
              ['success', '成功'],
              ['failed', '失败'],
              ['running', '执行中'],
              ['pending', '等待'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} className="btn sm ghost" onClick={() => setFilter(key)} style={filter === key ? { background: 'var(--bg-3)', color: 'var(--text)' } : undefined}>
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {running && (
            <button className="btn sm danger" onClick={cancel}>
              取消任务
            </button>
          )}
          {!running && counts.failed > 0 && (
            <button className="btn sm" onClick={retryFailed}>
              重试失败 ({counts.failed})
            </button>
          )}
          <button className="btn sm ghost" onClick={exportCsv}>
            导出 CSV
          </button>
        </div>
      </div>

      <div className="section" style={{ margin: '0 12px 12px' }}>
        <div className="section-head">各机器执行状态</div>
        {filtered.length === 0 && <div style={{ padding: 14, color: 'var(--text-faint)' }}>没有符合条件的机器</div>}
        {filtered.map((r) => {
          const isOpen = expanded === r.id
          const failed = FAIL.includes(r.status)
          return (
            <div key={r.id}>
              <div className="result-row" onClick={() => setExpanded(isOpen ? null : r.id)}>
                <StatusDot status={r.status} kind="result" />
                <span className="hname">{r.host_name}</span>
                {r.retry_count > 0 && <span className="tag">重试 {r.retry_count}</span>}
                {r.exit_code != null && <span className="dur">rc={r.exit_code}</span>}
                <span className="dur">{formatDuration(r.duration_ms)}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
              </div>
              {isOpen && (
                <div className="result-detail">
                  <div className="kv">
                    <span className="k">开始</span>
                    <span className="v">{formatDateTime(r.started_at)}</span>
                    <span className="k">结束</span>
                    <span className="v">{formatDateTime(r.finished_at)}</span>
                    <span className="k">耗时</span>
                    <span className="v">{formatDuration(r.duration_ms)}</span>
                    <span className="k">退出码</span>
                    <span className="v">{r.exit_code ?? '—'}</span>
                    <span className="k">重试次数</span>
                    <span className="v">{r.retry_count}</span>
                    {r.error_message && (
                      <>
                        <span className="k">错误</span>
                        <span className="v" style={{ color: 'var(--red)' }}>
                          {r.error_message}
                        </span>
                      </>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 3 }}>标准输出</div>
                  <pre className={`log${r.stdout ? '' : ' empty'}`}>{r.stdout || '（无输出）'}</pre>

                  {r.stderr && (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '8px 0 3px' }}>错误输出</div>
                      <pre className="log err">{r.stderr}</pre>
                    </>
                  )}

                  {failed && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                      <button className="btn sm" onClick={() => retryHost(r.host_id)}>
                        重试此机器
                      </button>
                      <button className="btn sm ghost" onClick={() => navigator.clipboard?.writeText(r.stdout || r.stderr || '')}>
                        复制输出
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type { RunResult }
