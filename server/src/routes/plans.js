import express from 'express'
import crypto from 'node:crypto'
import { getDb, nowIso, clean, jsonParse } from '../db.js'
import { reloadPlan, unregisterPlan, triggerPlan, computeNextRun, validateCron, nextCronDate } from '../scheduler.js'

export function plansRouter() {
  const router = express.Router()

  router.get('/', (req, res) => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all()
    res.json({ plans: rows.map(serializePlan) })
  })

  router.post('/', (req, res) => {
    const body = req.body || {}
    const error = validatePlan(body)
    if (error) return res.status(400).json({ error })

    const db = getDb()
    const id = crypto.randomUUID()
    const now = nowIso()
    db.prepare(
      `INSERT INTO plans
       (id, name, description, enabled, host_ids, command, type, schedule_type, cron_expression, interval_seconds,
        concurrency, timeout_seconds, retry_count, continue_on_error, skip_offline, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      ...clean([
        id,
        body.name,
        body.description || null,
        body.enabled === false ? 0 : 1,
        JSON.stringify(body.hostIds || []),
        body.command || '',
        body.type || 'command',
        body.scheduleType || 'manual',
        body.cronExpression || null,
        body.intervalSeconds ?? null,
        Number(body.concurrency) || 5,
        Number(body.timeoutSeconds) || 60,
        Number(body.retryCount) || 0,
        body.continueOnError === false ? 0 : 1,
        body.skipOffline === false ? 0 : 1,
        now,
        now,
      ]),
    )
    reloadPlan(id)
    const created = db.prepare('SELECT * FROM plans WHERE id = ?').get(id)
    res.status(201).json({ plan: serializePlan(created) })
  })

  router.put('/:id', (req, res) => {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: '计划不存在' })

    const body = req.body || {}
    const patch = {
      name: body.name ?? existing.name,
      description: body.description !== undefined ? body.description : existing.description,
      enabled: body.enabled != null ? (body.enabled ? 1 : 0) : existing.enabled,
      host_ids: body.hostIds !== undefined ? JSON.stringify(body.hostIds) : existing.host_ids,
      command: body.command ?? existing.command,
      type: body.type ?? existing.type,
      schedule_type: body.scheduleType ?? existing.schedule_type,
      cron_expression: body.cronExpression !== undefined ? body.cronExpression : existing.cron_expression,
      interval_seconds: body.intervalSeconds !== undefined ? body.intervalSeconds : existing.interval_seconds,
      concurrency: body.concurrency != null ? Number(body.concurrency) : existing.concurrency,
      timeout_seconds: body.timeoutSeconds != null ? Number(body.timeoutSeconds) : existing.timeout_seconds,
      retry_count: body.retryCount != null ? Number(body.retryCount) : existing.retry_count,
      continue_on_error: body.continueOnError != null ? (body.continueOnError ? 1 : 0) : existing.continue_on_error,
      skip_offline: body.skipOffline != null ? (body.skipOffline ? 1 : 0) : existing.skip_offline,
      updated_at: nowIso(),
    }

    const err = validatePlan({
      name: patch.name,
      command: patch.command,
      hostIds: jsonParse(patch.host_ids, []),
      scheduleType: patch.schedule_type,
      cronExpression: patch.cron_expression,
    })
    if (err) return res.status(400).json({ error: err })

    const cols = Object.keys(patch)
    db.prepare(`UPDATE plans SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...clean([...cols.map((c) => patch[c]), req.params.id]),
    )
    reloadPlan(req.params.id)
    const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)
    res.json({ plan: serializePlan(updated) })
  })

  router.delete('/:id', (req, res) => {
    const db = getDb()
    unregisterPlan(req.params.id)
    db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  router.post('/:id/run', (req, res) => {
    const runId = triggerPlan(req.params.id, 'manual')
    if (!runId) return res.status(400).json({ error: '计划未配置目标主机或不存在' })
    res.json({ runId })
  })

  router.post('/:id/toggle', (req, res) => {
    const db = getDb()
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)
    if (!plan) return res.status(404).json({ error: '计划不存在' })
    const enabled = plan.enabled ? 0 : 1
    db.prepare('UPDATE plans SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled, nowIso(), req.params.id)
    reloadPlan(req.params.id)
    const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)
    res.json({ plan: serializePlan(updated) })
  })

  // Preview the next N fire times for a cron expression (no plan id needed).
  router.post('/preview', (req, res) => {
    const { cronExpression, count = 5 } = req.body || {}
    if (!validateCron(cronExpression)) return res.status(400).json({ error: 'Cron 表达式无效' })
    res.json({ next: previewCron(cronExpression, count) })
  })

  router.post('/:id/preview', (req, res) => {
    const { cronExpression, count = 5 } = req.body || {}
    if (!validateCron(cronExpression)) return res.status(400).json({ error: 'Cron 表达式无效' })
    res.json({ next: previewCron(cronExpression, count) })
  })

  return router
}

function previewCron(cronExpression, count) {
  const runs = []
  let cursor = new Date()
  for (let i = 0; i < Math.min(Number(count) || 5, 10); i += 1) {
    const next = nextCronDate(cronExpression, cursor)
    if (!next) break
    runs.push(next)
    cursor = new Date(new Date(next).getTime() + 60000)
  }
  return runs
}

function validatePlan(body) {
  if (!body.name) return '计划名称不能为空'
  if (!body.command) return '执行命令不能为空'
  if (!body.hostIds || !body.hostIds.length) return '至少选择一台目标主机'
  if (body.scheduleType === 'cron' && !validateCron(body.cronExpression)) return 'Cron 表达式无效'
  if (body.scheduleType === 'interval' && !(Number(body.intervalSeconds) >= 30)) return '间隔时间至少 30 秒'
  return null
}

export function serializePlan(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: !!row.enabled,
    hostIds: jsonParse(row.host_ids, []),
    command: row.command,
    type: row.type,
    scheduleType: row.schedule_type,
    cronExpression: row.cron_expression,
    intervalSeconds: row.interval_seconds,
    concurrency: row.concurrency,
    timeoutSeconds: row.timeout_seconds,
    retryCount: row.retry_count,
    continueOnError: !!row.continue_on_error,
    skipOffline: !!row.skip_offline,
    lastRunId: row.last_run_id,
    nextRunAt: row.next_run_at || computeNextRun(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
