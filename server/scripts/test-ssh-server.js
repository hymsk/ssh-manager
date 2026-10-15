// Minimal in-process SSH server for local testing of the manager.
// Usage: node scripts/test-ssh-server.js [port]
import ssh2 from 'ssh2'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const { Server } = ssh2

const port = Number(process.argv[2] || 2222)

// Persist the host key so fingerprints stay stable across restarts.
const keyPath = path.resolve(process.env.TEST_SSH_KEY || './scripts/test-host-key.pem')
let privateKey
if (fs.existsSync(keyPath)) {
  privateKey = fs.readFileSync(keyPath, 'utf8')
} else {
  privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 })
}

const HOSTNAME = process.env.TEST_SSH_HOSTNAME || 'test-box'

const server = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'root' && ctx.password === 'test1234') {
      return ctx.accept()
    }
    return ctx.reject(['password'])
  })

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty())
      session.on('window-change', () => {})
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        const cmd = info.command
        let out = ''
        if (/hostname/.test(cmd)) out += `${HOSTNAME}\n`
        if (/uname/.test(cmd)) out += 'Linux test-box 6.1.0 #1 SMP x86_64 GNU/Linux\n'
        if (/df -h/.test(cmd)) out += 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1  40G  20G   20G  50% /\n'
        if (/free -m/.test(cmd)) out += '              total  used  free\nMem:          16000  4000 12000\n'
        if (/uptime/.test(cmd)) out += ' 10:00:00 up 3 days,  2:11,  1 user,  load average: 0.15, 0.10, 0.05\n'
        if (/exit 1|fail/.test(cmd)) {
          stream.stderr.write('simulated failure\n')
          stream.exit(1)
          return stream.end()
        }
        stream.write(out || `executed: ${cmd}\n`)
        stream.exit(0)
        stream.end()
      })
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        stream.write(`Welcome to ${HOSTNAME} (mock)\r\n`)
        stream.write('$ ')
        stream.on('data', (data) => {
          const text = data.toString()
          if (text.includes('\r')) {
            stream.write(`\r\n${HOSTNAME}: command simulated\r\n$ `)
          }
        })
      })
    })
  })
  client.on('error', () => {})
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock ssh server on 127.0.0.1:${port} (root / test1234)`)
})
