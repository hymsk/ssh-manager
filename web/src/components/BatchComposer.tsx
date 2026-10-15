import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import type { BatchDraft, CommandTemplate } from '../types'
import { StatusDot } from './StatusDot'
import { Modal } from './Modal'

interface Props {
  /** Preselected host ids; defaults to the current left-panel selection. */
  hostIds?: string[]
}

const DEFAULT_OPTIONS = {
  concurrency: 5,
  timeoutSeconds: 60,
  retryCount: 0,
  continueOnError: true,
  skipOffline: true,
}

export function BatchComposer({ hostIds }: Props) {
  const hosts = useStore((s) => s.hosts)
  const templates = useStore((s) => s.templates)
  const selected = useStore((s) => s.selectedHostIds)
  const startBatch = useStore((s) => s.startBatch)
  const pushToast = useStore((s) => s.pushToast)

  const initial = hostIds ?? selected
  const [targets, setTargets] = useState<string[]>(initial)
  const [name, setName] = useState('即时执行任务')
  const [command, setCommand] = useState('')
  const [type, setType] = useState<'command' | 'script'>('command')
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS })
  const [activeTemplate, setActiveTemplate] = useState<CommandTemplate | null>(null)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [saveAsPlan, setSaveAsPlan] = useState(false)
  const [planSchedule, setPlanSchedule] = useState<'manual' | 'cron' | 'interval'>('manual')
  const [cronExpression, setCronExpression] = useState('0 2 * * *')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [cronPreview, setCronPreview] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const selectedHosts = useMemo(() => hosts.filter((h) => targets.includes(h.id)), [hosts, targets])
  const offlineCount = selectedHosts.filter((h) => h.status !== 'online').length

  const renderedCommand = useMemo(() => {
    let out = command
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v)
    return out
  }, [command, vars])

  function toggleTarget(id: string) {
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function applyTemplate(tpl: CommandTemplate) {
    setActiveTemplate(tpl)
    setCommand(tpl.command)
    setType(tpl.type)
    const init: Record<string, string> = {}
    for (const v of tpl.variables || []) init[v.key] = v.default
    setVars(init)
  }

  async function previewCron() {
    try {
      const { next } = await api.previewCron(cronExpression, 5)
      setCronPreview(next)
    } catch {
      setCronPreview([])
      pushToast('error', 'Cron 表达式无效')
    }
  }

  async function submit() {
    if (!targets.length) return pushToast('error', '请至少选择一台目标主机')
    if (!renderedCommand.trim()) return pushToast('error', '请填写执行命令')

    setBusy(true)
    try {
      const draft: BatchDraft = {
        name: name.trim() || '即时任务',
        command: renderedCommand,
        type,
        hostIds: targets,
        options,
      }
      const runId = await startBatch(draft)
      if (!runId) return

      if (saveAsPlan) {
        await api.createPlan({
          name: name.trim() || '未命名计划',
          hostIds: targets,
          command: renderedCommand,
          type,
          enabled: true,
          scheduleType: planSchedule,
          cronExpression: planSchedule === 'cron' ? cronExpression : null,
          intervalSeconds: planSchedule === 'interval' ? intervalMinutes * 60 : null,
          concurrency: options.concurrency,
          timeoutSeconds: options.timeoutSeconds,
          retryCount: options.retryCount,
          continueOnError: options.continueOnError,
          skipOffline: options.skipOffline,
        })
        await useStore.getState().refreshPlans()
        pushToast('success', '已保存为执行计划')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section" style={{ margin: 0, border: 'none', background: 'transparent' }}>
      <div className="section-head" style={{ borderRadius: 0 }}>
        <span>批量执行配置</span>
        <span className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>目标 {targets.length} 台</span>
      </div>

      <div style={{ padding: 12 }}>
        <div className="grid2">
          <div className="field">
            <label>任务名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>执行类型</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as 'command' | 'script')}>
              <option value="command">Shell 命令</option>
              <option value="script">Shell 脚本</option>
            </select>
          </div>
        </div>

        {templates.length > 0 && (
          <div className="field">
            <label>命令模板</label>
            <div className="template-list">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={`template-pill${activeTemplate?.id === t.id ? ' active' : ''}`}
                  onClick={() => applyTemplate(t)}
                  title={t.description}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTemplate?.variables && activeTemplate.variables.length > 0 && (
          <div className="grid2">
            {activeTemplate.variables.map((v) => (
              <div className="field" key={v.key}>
                <label>{v.label}</label>
                <input
                  className="input"
                  value={vars[v.key] ?? ''}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label>执行内容</label>
          <textarea
            className="textarea"
            style={type === 'script' ? { minHeight: 140 } : undefined}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setActiveTemplate(null)
            }}
            placeholder={type === 'script' ? '#!/bin/bash\nset -e\n...' : 'systemctl restart nginx'}
          />
          {activeTemplate && renderedCommand !== command && (
            <div className="hint">实际执行：{renderedCommand.slice(0, 160)}</div>
          )}
        </div>

        <div className="grid3">
          <div className="field">
            <label>并发数量</label>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={options.concurrency}
              onChange={(e) => setOptions((o) => ({ ...o, concurrency: Number(e.target.value) }))}
            />
          </div>
          <div className="field">
            <label>单机超时（秒）</label>
            <input
              className="input"
              type="number"
              min={1}
              value={options.timeoutSeconds}
              onChange={(e) => setOptions((o) => ({ ...o, timeoutSeconds: Number(e.target.value) }))}
            />
          </div>
          <div className="field">
            <label>失败重试（次）</label>
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              value={options.retryCount}
              onChange={(e) => setOptions((o) => ({ ...o, retryCount: Number(e.target.value) }))}
            />
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.continueOnError}
            onChange={(e) => setOptions((o) => ({ ...o, continueOnError: e.target.checked }))}
          />
          某台失败后继续执行其他主机
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.skipOffline}
            onChange={(e) => setOptions((o) => ({ ...o, skipOffline: e.target.checked }))}
          />
          自动跳过离线主机
        </label>

        <div className="field">
          <label>
            目标主机
            {offlineCount > 0 && <span className="hint"> · {offlineCount} 台非在线</span>}
          </label>
          <div className="host-select-list">
            {hosts.length === 0 && <div style={{ padding: 10, color: 'var(--text-faint)' }}>暂无主机</div>}
            {hosts.map((h) => (
              <label className="host-select-item" key={h.id}>
                <input type="checkbox" checked={targets.includes(h.id)} onChange={() => toggleTarget(h.id)} style={{ accentColor: 'var(--accent)' }} />
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

        <label className="checkbox">
          <input type="checkbox" checked={saveAsPlan} onChange={(e) => setSaveAsPlan(e.target.checked)} />
          同时保存为执行计划
        </label>

        {saveAsPlan && (
          <div style={{ padding: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="field">
              <label>调度方式</label>
              <select
                className="select"
                value={planSchedule}
                onChange={(e) => setPlanSchedule(e.target.value as typeof planSchedule)}
              >
                <option value="manual">仅手动执行</option>
                <option value="cron">Cron 表达式</option>
                <option value="interval">固定间隔</option>
              </select>
            </div>

            {planSchedule === 'cron' && (
              <>
                <div className="field">
                  <label>Cron（分 时 日 月 周）</label>
                  <input className="input" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} />
                </div>
                <button className="btn sm" onClick={previewCron}>
                  预览下次执行时间
                </button>
                {cronPreview.length > 0 && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    {cronPreview.map((t) => new Date(t).toLocaleString()).join(' · ')}
                  </div>
                )}
              </>
            )}

            {planSchedule === 'interval' && (
              <div className="field">
                <label>间隔（分钟）</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                />
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn primary block" onClick={submit} disabled={busy}>
            {busy ? '正在创建…' : '立即执行'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Standalone modal wrapper used from the host card "执行" button. */
export function SingleHostExecModal({ hostId, onClose }: { hostId: string; onClose: () => void }) {
  return (
    <Modal title="执行命令" onClose={onClose} wide>
      <BatchComposer hostIds={[hostId]} />
    </Modal>
  )
}
