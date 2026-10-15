import express from 'express'
import crypto from 'node:crypto'
import { getDb, nowIso, clean, jsonParse } from '../db.js'
import { encryptSecret, decryptSecret } from '../crypto.js'
import { probeById, getProbeConfig } from '../ssh/prober.js'
import { execCommand, connect } from '../ssh/connect.js'
import { emit } from '../events.js'

export function hostsRouter({ key }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM hosts ORDER BY favorite DESC, name').all()
    res.json({ hosts: rows.map(publicHost), probe: getProbeConfig() })
  })

  router.post('/', (req, res) => {
    const db = getDb()
    const body = req.body || {}
    const error = validateHost(body)
    if (error) return res.status(400).json({ error })

    const id = crypto.randomUUID()
    const now = nowIso()
    db.prepare(
      `INSERT INTO hosts
       (id, name, host, port, username, auth_type, secret, passphrase, group_name, tags, favorite, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'unknown',?,?)`,
    ).run(
      ...clean([
        id,
        body.name,
        body.host,
        Number(body.port) || 22,
        body.username,
        body.authType || 'password',
        encryptSecret(body.password || body.privateKey, key),
        encryptSecret(body.passphrase, key),
        body.group || null,
        JSON.stringify(body.tags || []),
        body.favorite ? 1 : 0,
        now,
        now,
      ]),
    )

    const created = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id)
    emit('host_created', publicHost(created))
    // Probe asynchronously so the request returns fast.
    probeById(id).catch(() => {})
    res.status(201).json({ host: publicHost(created) })
  })

  router.put('/:id', (req, res) => {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: '主机不存在' })

    const body = req.body || {}
    const error = validateHost(body, false)
    if (error) return res.status(400).json({ error })

    const patch = {
      name: body.name ?? existing.name,
      host: body.host ?? existing.host,
      port: body.port != null ? Number(body.port) : existing.port,
      username: body.username ?? existing.username,
      auth_type: body.authType ?? existing.auth_type,
      group_name: body.group !== undefined ? body.group : existing.group_name,
      tags: body.tags !== undefined ? JSON.stringify(body.tags) : existing.tags,
      favorite: body.favorite != null ? (body.favorite ? 1 : 0) : existing.favorite,
      updated_at: nowIso(),
    }

    // Only replace secrets when a new value is supplied.
    if (body.password) patch.secret = encryptSecret(body.password, key)
    if (body.privateKey) patch.secret = encryptSecret(body.privateKey, key)
    if (body.passphrase !== undefined) patch.passphrase = encryptSecret(body.passphrase, key)

    const cols = Object.keys(patch)
    db.prepare(`UPDATE hosts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...clean([...cols.map((c) => patch[c]), req.params.id]),
    )

    const updated = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id)
    emit('host_updated', publicHost(updated))
    probeById(req.params.id).catch(() => {})
    res.json({ host: publicHost(updated) })
  })

  router.delete('/:id', (req, res) => {
    const db = getDb()
    db.prepare('DELETE FROM hosts WHERE id = ?').run(req.params.id)
    emit('host_deleted', { id: req.params.id })
    res.json({ ok: true })
  })

  router.post('/:id/probe', async (req, res) => {
    const host = await probeById(req.params.id)
    if (!host) return res.status(404).json({ error: '主机不存在' })
    res.json({ host: publicHost(host) })
  })

  router.post('/:id/test', async (req, res) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '主机不存在' })
    let client = null
    try {
      const started = Date.now()
      const { client: c } = await connect(row, key)
      client = c
      client.end()
      res.json({ ok: true, latencyMs: Date.now() - started })
    } catch (err) {
      res.status(200).json({ ok: false, error: err.message })
    } finally {
      try {
        client?.end()
      } catch {
        /* ignore */
      }
    }
  })

  // One-off command against a single host (used by the card "执行" button).
  router.post('/:id/exec', async (req, res) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '主机不存在' })
    const { command, timeoutSeconds = 60 } = req.body || {}
    if (!command) return res.status(400).json({ error: '命令不能为空' })

    let client = null
    try {
      const { client: c } = await connect(row, key)
      client = c
      const result = await execCommand(client, command, { timeoutMs: timeoutSeconds * 1000 })
      res.json(result)
    } catch (err) {
      res.status(200).json({
        status: 'failed',
        exitCode: null,
        stdout: '',
        stderr: '',
        errorMessage: err.message,
        durationMs: 0,
      })
    } finally {
      try {
        client?.end()
      } catch {
        /* ignore */
      }
    }
  })

  return router
}

function validateHost(body, requireSecret = true) {
  if (!body.name) return '名称不能为空'
  if (!body.host) return '主机地址不能为空'
  if (!body.username) return '用户名不能为空'
  if (requireSecret) {
    const authType = body.authType || 'password'
    if (authType === 'password' && !body.password) return '密码认证需要填写密码'
    if (authType === 'privateKey' && !body.privateKey) return '私钥认证需要填写私钥内容'
  }
  return null
}

/** Never leak secrets through the API. */
export function publicHost(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    group: row.group_name,
    tags: jsonParse(row.tags, []),
    favorite: !!row.favorite,
    hostFingerprint: row.host_fingerprint,
    hasSecret: !!row.secret,
    hasPassphrase: !!row.passphrase,
    status: row.status,
    latencyMs: row.latency_ms,
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    lastOnlineAt: row.last_online_at,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export { decryptSecret }
