import crypto from 'node:crypto'
import { getDb, nowIso, clean } from '../db.js'
import { connect, execCommand, classifyError } from './connect.js'
import { mapLimit } from './prober.js'
import { emit } from '../events.js'

const activeRuns = new Map()

/** Result states that count as a failure when summarising a run. */
export const FAILURE_STATES = new Set(['failed', 'timeout', 'disconnected', 'error', 'auth_failed', 'offline'])

export function getActiveRunIds() {
  return [...activeRuns.keys()]
}

/**
 * Start a batch run.
 * options: { concurrency, timeoutSeconds, retryCount, continueOnError, skipOffline }
 * Returns { runId }.
 */
export function startRun({ name, command, type = 'command', hostIds, planId = null, trigger = 'manual', options = {} }, key) {
  const db = getDb()
  const runId = crypto.randomUUID()
  const hostRows = hostIds
    .map((id) => db.prepare('SELECT * FROM hosts WHERE id = ?').get(id))
    .filter(Boolean)

  const opts = {
    concurrency: clamp(options.concurrency ?? 5, 1, 50),
    timeoutSeconds: clamp(options.timeoutSeconds ?? 60, 1, 86400),
    retryCount: clamp(options.retryCount ?? 0, 0, 10),
    continueOnError: options.continueOnError !== false,
    skipOffline: options.skipOffline !== false,
  }

  db.prepare(
    `INSERT INTO runs (id, plan_id, name, command, type, trigger, status, total_hosts, started_at, options)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
  ).run(...clean([runId, planId, name || '未命名任务', command, type, trigger, hostRows.length, nowIso(), JSON.stringify(opts)]))

  const insertResult = db.prepare(
    `INSERT INTO run_results (id, run_id, host_id, host_name, status) VALUES (?, ?, ?, ?, 'pending')`,
  )

  const targets = []
  const skipped = []
  for (const row of hostRows) {
    if (opts.skipOffline && row.status !== 'online') {
      skipped.push(row)
      insertResult.run(crypto.randomUUID(), runId, row.id, row.name)
      db.prepare(
        `UPDATE run_results SET status = 'skipped', error_message = ? WHERE run_id = ? AND host_id = ?`,
      ).run(`主机当前状态为 ${row.status}，已跳过`, runId, row.id)
    } else {
      insertResult.run(crypto.randomUUID(), runId, row.id, row.name)
      targets.push(row)
    }
  }

  db.prepare(`UPDATE runs SET skipped_count = ? WHERE id = ?`).run(skipped.length, runId)

  emit('run_started', serializeRun(runId))
  for (const row of hostRows) emit('run_host', buildHostEvent(runId, row.id))

  const controller = { cancelled: false }
  activeRuns.set(runId, controller)

  // Execute in background; caller returns immediately.
  executeRun(runId, targets, command, opts, key, controller).catch((err) => {
    console.error('[runner] unexpected failure', err)
    finishRun(runId, 'failed')
  }).finally(() => {
    activeRuns.delete(runId)
  })

  return { runId, skipped: skipped.map((r) => ({ id: r.id, name: r.name })) }
}

export function cancelRun(runId) {
  const c = activeRuns.get(runId)
  if (!c) return false
  c.cancelled = true
  return true
}

/** Re-run only the failed/timeout hosts of a previous run. */
export function retryFailed(runId, key) {
  const db = getDb()
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId)
  if (!run) return null
  const failed = db
    .prepare(`SELECT host_id FROM run_results WHERE run_id = ? AND status IN ('failed','timeout','disconnected','error')`)
    .all(runId)
    .map((r) => r.host_id)
  if (!failed.length) return { runId: null, hostIds: [] }

  const options = JSON.parse(run.options || '{}')
  const res = startRun(
    {
      name: `${run.name}（重试失败）`,
      command: run.command,
      type: run.type,
      hostIds: failed,
      planId: run.plan_id,
      trigger: 'retry',
      options: { ...options, skipOffline: false },
    },
    key,
  )
  return { ...res, hostIds: failed }
}

async function executeRun(runId, targets, command, opts, key, controller) {
  await mapLimit(targets, opts.concurrency, async (row) => {
    // When continueOnError is false, stop launching new hosts after a failure.
    if (controller.cancelled || controller.stopScheduling) {
      updateResult(runId, row.id, {
        status: 'cancelled',
        error_message: controller.cancelled ? '任务已取消' : '前序主机执行失败，已中止',
        finished_at: nowIso(),
      })
      emit('run_host', buildHostEvent(runId, row.id))
      return
    }
    await runOnHost(runId, row, command, opts, key, controller)
  })

  const run = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId)
  let status = 'success'
  if (controller.cancelled) status = 'cancelled'
  else if (run.failed_count > 0 && run.success_count > 0) status = 'partial'
  else if (run.failed_count > 0) status = 'failed'
  else if (run.skipped_count > 0 && run.success_count === 0) status = 'failed'
  finishRun(runId, status)
}

async function runOnHost(runId, row, command, opts, key, controller) {
  const maxAttempts = opts.retryCount + 1
  let attempt = 0
  let attemptsMade = 0
  let lastResult = null

  while (attempt < maxAttempts) {
    if (attempt === 0) {
      updateResult(runId, row.id, { status: 'connecting', started_at: nowIso() })
    } else {
      updateResult(runId, row.id, { status: 'connecting', retry_count: attempt })
    }
    emit('run_host', buildHostEvent(runId, row.id))

    if (controller.cancelled) {
      updateResult(runId, row.id, { status: 'cancelled', finished_at: nowIso(), retry_count: Math.max(0, attemptsMade - 1) })
      emit('run_host', buildHostEvent(runId, row.id))
      recomputeCounters(runId)
      return
    }

    let client = null
    attemptsMade += 1
    try {
      const res = await connect(row, key)
      client = res.client
      updateResult(runId, row.id, { status: 'running', retry_count: attempt })
      emit('run_host', buildHostEvent(runId, row.id))

      const result = await execCommand(client, command, {
        timeoutMs: opts.timeoutSeconds * 1000,
      })
      lastResult = {
        status: result.status,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
      }
    } catch (err) {
      const { status, message } = classifyError(err)
      lastResult = { status, exitCode: null, stdout: '', stderr: '', errorMessage: message, durationMs: null }
    } finally {
      try {
        client?.end()
      } catch {
        /* ignore */
      }
    }

    // Success ends immediately; failures retry until attempts are exhausted.
    if (lastResult.status === 'success') break
    attempt += 1
    if (attempt < maxAttempts) await sleep(500)
  }

  // A definitive failure halts scheduling of not-yet-started hosts when configured.
  if (lastResult && lastResult.status !== 'success' && !opts.continueOnError) {
    controller.stopScheduling = true
  }

  if (lastResult) {
    updateResult(runId, row.id, {
      status: lastResult.status,
      exit_code: lastResult.exitCode ?? null,
      stdout: truncate(lastResult.stdout),
      stderr: truncate(lastResult.stderr),
      error_message: lastResult.errorMessage,
      finished_at: nowIso(),
      duration_ms: lastResult.durationMs,
      retry_count: Math.max(0, attemptsMade - 1),
    })
  }
  emit('run_host', buildHostEvent(runId, row.id))
  recomputeCounters(runId)
}

function recomputeCounters(runId) {
  const db = getDb()
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM run_results WHERE run_id = ? GROUP BY status').all(runId)
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]))
  const success = by.success || 0
  const failed = Object.entries(by)
    .filter(([status]) => FAILURE_STATES.has(status))
    .reduce((sum, [, n]) => sum + n, 0)
  const skipped = by.skipped || 0
  db.prepare('UPDATE runs SET success_count = ?, failed_count = ?, skipped_count = ? WHERE id = ?').run(success, failed, skipped, runId)
}

function finishRun(runId, status) {
  const db = getDb()
  db.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(status, nowIso(), runId)
  emit('run_finished', serializeRun(runId))
}

function updateResult(runId, hostId, patch) {
  const db = getDb()
  const cols = Object.keys(patch)
  if (!cols.length) return
  const sql = `UPDATE run_results SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE run_id = ? AND host_id = ?`
  db.prepare(sql).run(...clean([...cols.map((c) => patch[c]), runId, hostId]))
}

function buildHostEvent(runId, hostId) {
  const db = getDb()
  const result = db.prepare('SELECT * FROM run_results WHERE run_id = ? AND host_id = ?').get(runId, hostId)
  const run = db.prepare('SELECT status, success_count, failed_count, skipped_count, total_hosts FROM runs WHERE id = ?').get(runId)
  return { runId, result, counts: run }
}

export function serializeRun(runId) {
  const db = getDb()
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId)
  return serializeRunRow(run)
}

export function serializeRunRow(run) {
  if (!run) return null
  return { ...run, options: JSON.parse(run.options || '{}') }
}

export function serializeRunDetail(runId) {
  const db = getDb()
  const run = serializeRun(runId)
  if (!run) return null
  const results = db.prepare('SELECT * FROM run_results WHERE run_id = ? ORDER BY host_name').all(runId)
  return { ...run, results }
}

function clamp(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

function truncate(text, limit = 200000) {
  if (!text) return text ?? null
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[输出已截断，共 ${text.length} 字符]`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
