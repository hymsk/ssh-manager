import { useEffect, useMemo, useState } from 'react'
import type { Plan } from '../types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { Modal } from './Modal'
import { StatusDot } from './StatusDot'

interface Props {
  plan: Plan | null
  onClose: () => void
  onSaved: () => void
}

const DEFAULT = {
  name: '',
  description: '',
  command: '',
  type: 'command' as 'command' | 'script',
  scheduleType: 'manual' as 'manual' | 'cron' | 'interval',
  cronExpression: '0 2 * * *',
  intervalMinutes: 60,
  concurrency: 5,
  timeoutSeconds: 60,
  retryCount: 0,
  continueOnError: true,
  skipOffline: true,
  enabled: true,
}

export function PlanEditor({ plan, onClose, onSaved }: Props) {
  const hosts = useStore((s) => s.hosts)
  const pushToast = useStore((s) => s.pushToast)
  const [form, setForm] = useState(DEFAULT)
  const [targets, setTargets] = useState<string[]>([])
  const [cronPreview, setCronPreview] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const isEdit = !!plan

  useEffect(() => {
    if (plan) {
      setForm({
        name: plan.name,
        description: plan.description || '',
        command: plan.command,
        type: plan.type,
        scheduleType: plan.scheduleType,
        cronExpression: plan.cronExpression || '0 2 * * *',
        intervalMinutes: Math.round((plan.intervalSeconds || 3600) / 60),
        concurrency: plan.concurrency,
        timeoutSeconds: plan.timeoutSeconds,
        retryCount: plan.retryCount,
        continueOnError: plan.continueOnError,
        skipOffline: plan.skipOffline,
        enabled: plan.enabled,
      })
      setTargets(plan.hostIds)
    } else {
      setForm(DEFAULT)
      setTargets([])
    }
  }, [plan])

  const set = <K extends keyof typeof DEFAULT>(k: K, v: (typeof DEFAULT)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const offlineCount = useMemo(() => hosts.filter((h) => targets.includes(h.id) && h.status !== 'online').length, [hosts, targets])

  async function previewCron() {
    try {
      const { next } = await api.previewCron(form.cronExpression, 5)
      setCronPreview(next)
    } catch {
      setCronPreview([])
      pushToast('error', 'Cron 表达式无效')
    }
  }

  async function save() {
    if (!form.name.trim()) return pushToast('error', '请填写计划名称')
    if (!form.command.trim()) return pushToast('error', '请填写执行命令')
    if (!targets.length) return pushToast('error', '请至少选择一台目标主机')

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      command: form.command,
      type: form.type,
      enabled: form.enabled,
      hostIds: targets,
      scheduleType: form.scheduleType,
      cronExpression: form.scheduleType === 'cron' ? form.cronExpression : null,
      intervalSeconds: form.scheduleType === 'interval' ? form.intervalMinutes * 60 : null,
      concurrency: form.concurrency,
      timeoutSeconds: form.timeoutSeconds,
      retryCount: form.retryCount,
      continueOnError: form.continueOnError,
      skipOffline: form.skipOffline,
    }

    setSaving(true)
    try {
      if (isEdit && plan) await api.updatePlan(plan.id, payload)
      else await api.createPlan(payload)
      pushToast('success', isEdit ? '计划已更新' : '计划已创建')
      onSaved()
      onClose()
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `配置计划 · ${plan?.name}` : '新建执行计划'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label>计划名称</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="每日服务器备份" />
        </div>
        <div className="field">
          <label>描述（可选）</label>
          <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>执行命令</label>
        <textarea className="textarea" value={form.command} onChange={(e) => set('command', e.target.value)} placeholder="df -h" />
      </div>

      <div className="grid2">
        <div className="field">
          <label>执行类型</label>
          <select className="select" value={form.type} onChange={(e) => set('type', e.target.value as 'command' | 'script')}>
            <option value="command">Shell 命令</option>
            <option value="script">Shell 脚本</option>
          </select>
        </div>
        <div className="field">
          <label>调度方式</label>
          <select
            className="select"
            value={form.scheduleType}
            onChange={(e) => set('scheduleType', e.target.value as typeof form.scheduleType)}
          >
            <option value="manual">仅手动执行</option>
            <option value="cron">Cron 表达式</option>
            <option value="interval">固定间隔</option>
          </select>
        </div>
      </div>

      {form.scheduleType === 'cron' && (
        <div className="field">
          <label>Cron（分 时 日 月 周）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={form.cronExpression} onChange={(e) => set('cronExpression', e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            <button className="btn" onClick={previewCron}>
              预览
            </button>
          </div>
          <div className="hint">例：0 2 * * * 每天 02:00 ｜ */30 * * * * 每 30 分钟 ｜ 0 3 * * 0 每周日 03:00</div>
          {cronPreview.length > 0 && (
            <div className="hint">
              下次执行：{cronPreview.map((t) => new Date(t).toLocaleString()).join(' · ')}
            </div>
          )}
        </div>
      )}

      {form.scheduleType === 'interval' && (
        <div className="field">
          <label>间隔（分钟，最小 1）</label>
          <input
            className="input"
            type="number"
            min={1}
            value={form.intervalMinutes}
            onChange={(e) => set('intervalMinutes', Number(e.target.value))}
          />
        </div>
      )}

      <div className="grid3">
        <div className="field">
          <label>并发数量</label>
          <input className="input" type="number" min={1} max={50} value={form.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>单机超时（秒）</label>
          <input className="input" type="number" min={1} value={form.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>失败重试（次）</label>
          <input className="input" type="number" min={0} max={10} value={form.retryCount} onChange={(e) => set('retryCount', Number(e.target.value))} />
        </div>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={form.continueOnError} onChange={(e) => set('continueOnError', e.target.checked)} />
        某台失败后继续执行其他主机
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={form.skipOffline} onChange={(e) => set('skipOffline', e.target.checked)} />
        自动跳过离线主机
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        启用此计划
      </label>

      <div className="field" style={{ marginTop: 12 }}>
        <label>
          目标主机 {offlineCount > 0 && <span className="hint">· {offlineCount} 台非在线</span>}
        </label>
        <div className="host-select-list">
          {hosts.map((h) => (
            <label className="host-select-item" key={h.id}>
              <input
                type="checkbox"
                checked={targets.includes(h.id)}
                onChange={() => setTargets((prev) => (prev.includes(h.id) ? prev.filter((x) => x !== h.id) : [...prev, h.id]))}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span style={{ flex: 1 }}>{h.name}</span>
              <span className="addr">
                {h.host}:{h.port}
              </span>
              <StatusDot status={h.status} kind="host" />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="btn sm ghost" onClick={() => setTargets(hosts.filter((h) => h.status === 'online').map((h) => h.id))}>
            仅在线
          </button>
          <button className="btn sm ghost" onClick={() => setTargets(hosts.map((h) => h.id))}>
            全部
          </button>
          <button className="btn sm ghost" onClick={() => setTargets([])}>
            清空
          </button>
        </div>
      </div>
    </Modal>
  )
}
