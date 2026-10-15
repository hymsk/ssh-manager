import express from 'express'
import cors from 'cors'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { initDb } from './db.js'
import { getKey } from './crypto.js'
import { startProber, stopProber, getProbeConfig } from './ssh/prober.js'
import { startScheduler, stopScheduler, validateCron } from './scheduler.js'
import { attachWebSocket } from './ws.js'
import { hostsRouter } from './routes/hosts.js'
import { plansRouter } from './routes/plans.js'
import { runsRouter } from './routes/runs.js'
import { templatesRouter } from './routes/templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8899)
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data')

const dataDir = DATA_DIR
initDb(dataDir)
const key = getKey(dataDir)

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    probe: getProbeConfig(),
    uptime: process.uptime(),
  })
})

app.get('/api/system/info', (req, res) => {
  res.json({
    platform: process.platform,
    node: process.version,
    dataDir,
    probe: getProbeConfig(),
  })
})

app.post('/api/system/validate-cron', (req, res) => {
  const { expression } = req.body || {}
  res.json({ valid: validateCron(expression) })
})

app.use('/api/hosts', hostsRouter({ key }))
app.use('/api/plans', plansRouter())
app.use('/api/runs', runsRouter({ key }))
app.use('/api/templates', templatesRouter())

// Serve the built frontend when present, so the same server can host web mode.
const webDist = path.resolve(__dirname, '../../web/dist')
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}

// Central error handler keeps API responses JSON-shaped.
app.use((err, req, res, next) => {
  console.error('[api] error:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

const server = http.createServer(app)
attachWebSocket(server, { key })

server.listen(PORT, () => {
  console.log(`\n  SSH Manager backend`)
  console.log(`  ➜  API:  http://localhost:${PORT}/api`)
  console.log(`  ➜  WS:   ws://localhost:${PORT}/ws`)
  console.log(`  ➜  Data: ${dataDir}`)
  console.log(`  ➜  Probe interval: ${getProbeConfig().intervalMs} ms\n`)
  startProber(key)
  startScheduler(key)
})

function shutdown() {
  console.log('\nShutting down...')
  stopProber()
  stopScheduler()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
