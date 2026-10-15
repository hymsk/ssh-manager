import express from 'express'
import { getDb } from '../db.js'
import { startRun, cancelRun, retryFailed, serializeRunRow, serializeRunDetail, FAILURE_STATES } from '../ssh/executor.js'

const FAILED = [...FAILURE_STATES]

export function runsRouter({ key }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const db = getDb()
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const rows = db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit)
    res.json({ runs: rows.map(serializeRunRow) })
  })

  router.get('/:id', (req, res) => {
    const detail = serializeRunDetail(req.params.id)
    if (!detail) return res.status(404).json({ error: '任务不存在' })
    res.json({ run: detail })
  })

  // Ad-hoc batch execution from the UI (not tied to a plan).
  router.post('/', (req, res) => {
    const body = req.body || {}
    if (!body.hostIds?.length) return res.status(400).json({ error: '至少选择一台目标主机' })
    if (!body.command) return res.status(400).json({ error: '执行命令不能为空' })

    const result = startRun(
      {
        name: body.name || '即时任务',
        command: body.command,
        type: body.type || 'command',
        hostIds: body.hostIds,
        trigger: 'manual',
        options: body.options || {},
      },
      key,
    )
    res.status(201).json(result)
  })

  router.post('/:id/cancel', (req, res) => {
    const ok = cancelRun(req.params.id)
    res.json({ ok })
  })

  router.post('/:id/retry-failed', (req, res) => {
    const result = retryFailed(req.params.id, key)
    if (!result) return res.status(404).json({ error: '任务不存在' })
    res.json(result)
  })

  // Retry a single host inside a run by creating a mini one-host run.
  router.post('/:id/retry-host', (req, res) => {
    const db = getDb()
    const detail = serializeRunDetail(req.params.id)
    if (!detail) return res.status(404).json({ error: '任务不存在' })
    const { hostId } = req.body || {}
    const target = detail.results.find((r) => r.host_id === hostId)
    if (!target) return res.status(404).json({ error: '该主机不在本次任务中' })
    if (!FAILED.includes(target.status)) return res.status(400).json({ error: '仅支持重试失败的主机' })

    const options = JSON.parse(detail.options || '{}')
    const result = startRun(
      {
        name: `${detail.name}（重试 ${target.host_name}）`,
        command: detail.command,
        type: detail.type,
        hostIds: [hostId],
        trigger: 'retry',
        options: { ...options, skipOffline: false },
      },
      key,
    )
    res.status(201).json(result)
  })

  router.delete('/', (req, res) => {
    const db = getDb()
    const { ids } = req.body || {}
    if (Array.isArray(ids) && ids.length) {
      const stmt = db.prepare('DELETE FROM runs WHERE id = ?')
      for (const id of ids) stmt.run(id)
      return res.json({ ok: true, deleted: ids.length })
    }
    db.prepare('DELETE FROM runs').run()
    res.json({ ok: true, deleted: 'all' })
  })

  return router
}
