import cron from 'node-cron'
import { getDb, nowIso, clean } from './db.js'
import { startRun } from './ssh/executor.js'
import { emit } from './events.js'

const jobs = new Map()
let masterKey = null

export function startScheduler(key) {
  masterKey = key
  const db = getDb()
  const plans = db.prepare('SELECT * FROM plans WHERE enabled = 1').all()
  for (const plan of plans) registerPlan(plan)
  refreshNextRunTimes()
}

export function reloadPlan(planId) {
  const db = getDb()
  unregisterPlan(planId)
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId)
  if (plan && plan.enabled) registerPlan(plan)
  refreshNextRunTimes()
}

export function unregisterPlan(planId) {
  const job = jobs.get(planId)
  if (job) {
    try {
      // node-cron v4: destroy() clears the expression and releases resources.
      if (typeof job.destroy === 'function') job.destroy()
      else job.stop()
    } catch {
      /* ignore */
    }
    jobs.delete(planId)
  }
}

function registerPlan(plan) {
  const scheduleType = plan.schedule_type
  if (scheduleType === 'manual' || !scheduleType) return

  if (scheduleType === 'cron') {
    const expr = normalizeCron(plan.cron_expression)
    if (!expr || !cron.validate(expr)) return
    const task = cron.schedule(expr, () => triggerPlan(plan.id, 'cron'))
    jobs.set(plan.id, task)
    return
  }

  if (scheduleType === 'interval') {
    const seconds = Math.max(30, Number(plan.interval_seconds) || 3600)
    const task = cron.schedule(`*/${Math.ceil(seconds / 60)} * * * *`, () => triggerPlan(plan.id, 'interval'))
    jobs.set(plan.id, task)
  }
}

export function triggerPlan(planId, trigger = 'manual') {
  const db = getDb()
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId)
  if (!plan) return null

  const hostIds = JSON.parse(plan.host_ids || '[]')
  if (!hostIds.length) {
    emit('plan_error', { planId, message: '计划未配置目标主机' })
    return null
  }

  const { runId } = startRun(
    {
      name: plan.name,
      command: plan.command,
      type: plan.type,
      hostIds,
      planId: plan.id,
      trigger,
      options: {
        concurrency: plan.concurrency,
        timeoutSeconds: plan.timeout_seconds,
        retryCount: plan.retry_count,
        continueOnError: !!plan.continue_on_error,
        skipOffline: !!plan.skip_offline,
      },
    },
    masterKey,
  )

  db.prepare('UPDATE plans SET last_run_id = ?, updated_at = ? WHERE id = ?').run(runId, nowIso(), plan.id)
  refreshNextRunTimes()
  return runId
}

export function refreshNextRunTimes() {
  const db = getDb()
  const plans = db.prepare('SELECT * FROM plans').all()
  for (const plan of plans) {
    const next = computeNextRun(plan)
    db.prepare('UPDATE plans SET next_run_at = ? WHERE id = ?').run(...clean([next, plan.id]))
  }
}

export function computeNextRun(plan, from = new Date()) {
  if (!plan.enabled) return null
  if (plan.schedule_type === 'cron') {
    const expr = normalizeCron(plan.cron_expression)
    if (!expr || !cron.validate(expr)) return null
    return nextCronDate(expr, from)
  }
  if (plan.schedule_type === 'interval') {
    const seconds = Math.max(30, Number(plan.interval_seconds) || 3600)
    return new Date(from.getTime() + seconds * 1000).toISOString()
  }
  return null
}

export function validateCron(expression) {
  const expr = normalizeCron(expression)
  return !!expr && cron.validate(expr)
}

/** node-cron accepts 5 or 6 fields; keep 5-field standard cron. */
export function normalizeCron(expression) {
  if (!expression) return null
  return String(expression).trim().split(/\s+/).slice(0, 5).join(' ')
}

/**
 * Compute the next matching date for a 5-field cron expression.
 * Minute-by-minute scan with a hard bound (~2 years) keeps this dependency-free.
 */
export function nextCronDate(expr, from = new Date()) {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = fields

  const date = new Date(from.getTime())
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)

  const limit = 60 * 24 * 366 * 2
  for (let i = 0; i < limit; i += 1) {
    if (
      matchField(minF, date.getMinutes(), 0, 59) &&
      matchField(hourF, date.getHours(), 0, 23) &&
      matchField(domF, date.getDate(), 1, 31) &&
      matchField(monF, date.getMonth() + 1, 1, 12) &&
      matchField(dowF, date.getDay(), 0, 6)
    ) {
      return date.toISOString()
    }
    date.setMinutes(date.getMinutes() + 1)
  }
  return null
}

function matchField(field, value, min, max) {
  if (field === '*' || field === '?') return true
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepRaw] = part.split('/')
      const step = Number(stepRaw)
      if (!step) continue
      const [start, end] = expandRange(range, min, max)
      for (let v = start; v <= end; v += step) if (v === value) return true
      continue
    }
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number)
      if (value >= start && value <= end) return true
      continue
    }
    if (Number(part) === value) return true
  }
  return false
}

function expandRange(range, min, max) {
  if (range === '*' || range === '?') return [min, max]
  if (range.includes('-')) {
    const [a, b] = range.split('-').map(Number)
    return [a, b]
  }
  const n = Number(range)
  return [n, max]
}

export function stopScheduler() {
  for (const id of jobs.keys()) unregisterPlan(id)
}
