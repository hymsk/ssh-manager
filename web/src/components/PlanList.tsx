import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { PlanEditor } from './PlanEditor'
import { scheduleText, formatCountdown, formatRelative } from '../lib/format'
import type { Plan } from '../types'

export function PlanList() {
  const plans = useStore((s) => s.plans)
  const refreshPlans = useStore((s) => s.refreshPlans)
  const refreshRuns = useStore((s) => s.refreshRuns)
  const loadRun = useStore((s) => s.loadRun)
  const pushToast = useStore((s) => s.pushToast)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)

  const sorted = useMemo(
    () => [...plans].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
    [plans],
  )

  async function runNow(plan: Plan) {
    try {
      const { runId } = await api.runPlan(plan.id)
      await loadRun(runId)
      await refreshRuns()
      pushToast('success', `计划「${plan.name}」已触发`)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  async function toggle(plan: Plan) {
    try {
      await api.togglePlan(plan.id)
      await refreshPlans()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  async function remove(plan: Plan) {
    if (!confirm(`确定删除计划「${plan.name}」？`)) return
    try {
      await api.deletePlan(plan.id)
      await refreshPlans()
      pushToast('success', '已删除计划')
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h3>执行计划</h3>
        <span className="count">{plans.length}</span>
        <span className="spacer" />
        <button
          className="btn sm primary"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          + 新建
        </button>
      </div>

      <div className="panel-body">
        {sorted.length === 0 && (
          <div className="empty">
            <div className="big">◷</div>
            <div>暂无执行计划</div>
            <div style={{ fontSize: 12 }}>点击「新建」配置定时批量任务</div>
          </div>
        )}

        {sorted.map((plan) => (
          <div key={plan.id} className={`plan-card${plan.enabled ? '' : ' disabled'}`}>
            <div className="row1">
              <span className="name" title={plan.name}>
                {plan.name}
              </span>
              <span className={`status ${plan.enabled ? 'st-online' : 'st-offline'}`}>
                <span className="dot" />
                {plan.enabled ? '已启用' : '已暂停'}
              </span>
            </div>

            <div className="meta">
              <span>{scheduleText(plan)}</span>
              <span>目标 {plan.hostIds.length} 台</span>
              <span>并发 {plan.concurrency}</span>
              {plan.retryCount > 0 && <span>重试 {plan.retryCount}</span>}
            </div>

            <div className="meta">
              {plan.enabled && plan.nextRunAt ? (
                <span>下次：{formatCountdown(plan.nextRunAt)}</span>
              ) : (
                <span>下次：—</span>
              )}
              <span>更新：{formatRelative(plan.updatedAt)}</span>
            </div>

            {plan.command && (
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  marginTop: 7,
                  background: 'var(--bg)',
                  padding: '5px 8px',
                  borderRadius: 5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {plan.command.split('\n')[0]}
              </div>
            )}

            <div className="actions">
              <button className="btn sm" onClick={() => runNow(plan)}>
                执行
              </button>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setEditing(plan)
                  setEditorOpen(true)
                }}
              >
                配置
              </button>
              {plan.lastRunId && (
                <button className="btn sm ghost" onClick={() => loadRun(plan.lastRunId!)}>
                  记录
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn sm ghost" onClick={() => toggle(plan)}>
                {plan.enabled ? '暂停' : '启用'}
              </button>
              <button className="btn sm ghost danger" onClick={() => remove(plan)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {editorOpen && (
        <PlanEditor plan={editing} onClose={() => setEditorOpen(false)} onSaved={refreshPlans} />
      )}
    </>
  )
}
