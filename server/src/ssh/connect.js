import ssh2 from 'ssh2'
import { decryptSecret } from '../crypto.js'

const { Client } = ssh2

/**
 * Build ssh2 connection options from a stored host row.
 * Secrets are decrypted here and never leave this module.
 */
export function buildConnectConfig(row, key) {
  const cfg = {
    host: row.host,
    port: row.port || 22,
    username: row.username,
    readyTimeout: Number(process.env.PROBE_CONNECT_TIMEOUT_MS || 5000),
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
  }

  switch (row.auth_type) {
    case 'privateKey': {
      const pem = decryptSecret(row.secret, key)
      if (!pem) throw new Error('无法解密私钥：密钥可能已更换')
      cfg.privateKey = pem
      const pass = decryptSecret(row.passphrase, key)
      if (pass) cfg.passphrase = pass
      break
    }
    case 'agent': {
      const sock = process.env.SSH_AUTH_SOCK
      if (!sock) throw new Error('未检测到 SSH_AUTH_SOCK，当前环境无法使用 ssh-agent')
      cfg.agent = sock
      break
    }
    case 'password':
    default: {
      const pass = decryptSecret(row.secret, key)
      if (!pass) throw new Error('无法解密密码：密钥可能已更换')
      cfg.password = pass
      break
    }
  }

  return cfg
}

/** Classify an ssh2/runtime error into a host status + human message. */
export function classifyError(err) {
  const msg = String(err?.message || err || '未知错误')
  const level = err?.level || ''

  if (level === 'client-authentication' || /authentication/i.test(msg)) {
    return { status: 'auth_failed', message: '认证失败：用户名、密码或密钥不正确' }
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(msg)) {
    return { status: 'timeout', message: '连接超时：主机无响应' }
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return { status: 'offline', message: '连接被拒绝：SSH 服务可能未启动' }
  }
  if (/EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return { status: 'offline', message: '网络不可达：无法解析或路由到主机' }
  }
  if (/Host key verification|REMOTE HOST IDENTIFICATION/i.test(msg)) {
    return { status: 'error', message: '主机指纹校验失败，存在中间人风险' }
  }
  return { status: 'offline', message: msg }
}

/**
 * Open a connection and resolve once authenticated.
 * Returns { client, fingerprint }.
 *
 * Trust-on-first-use: if the host has a stored fingerprint, a mismatch aborts
 * the connection (protects against MITM). Otherwise the new fingerprint is
 * returned so the caller can persist it.
 */
export function connect(row, key) {
  const cfg = buildConnectConfig(row, key)
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    let fingerprint = null
    let verificationError = null

    cfg.hostVerifier = (hashedKey) => {
      fingerprint = `SHA256:${hashedKey}`
      if (row.host_fingerprint && row.host_fingerprint !== fingerprint) {
        verificationError = new Error(
          `Host key verification failed: 主机指纹已变化\n已保存: ${row.host_fingerprint}\n当前:   ${fingerprint}`,
        )
        return false
      }
      return true
    }

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      fn(arg)
    }

    client.on('ready', () => {
      finish(resolve, { client, fingerprint })
    })
    client.on('error', (err) => {
      client.end()
      finish(reject, verificationError || err)
    })
    client.on('close', () => {
      finish(reject, verificationError || new Error('连接已关闭'))
    })
    client.on('handshake', () => {
      if (verificationError) {
        client.end()
        finish(reject, verificationError)
      }
    })

    try {
      client.connect(cfg)
    } catch (err) {
      finish(reject, err)
    }
  })
}

/** Run a single command over an existing client. */
export function execCommand(client, command, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let stdout = ''
    let stderr = ''
    let timer = null

    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ ...result, durationMs: Date.now() - startedAt })
    }

    client.exec(command, (err, stream) => {
      if (err) {
        return done({ status: 'failed', exitCode: null, stdout, stderr, errorMessage: err.message })
      }

      timer = setTimeout(() => {
        try {
          stream.close()
        } catch {
          /* ignore */
        }
        done({
          status: 'timeout',
          exitCode: null,
          stdout,
          stderr,
          errorMessage: `执行超时（${timeoutMs} ms）`,
        })
      }, timeoutMs)

      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
      stream.on('close', (code, signal) => {
        const exitCode = typeof code === 'number' ? code : null
        let status = 'success'
        let errorMessage = null
        if (exitCode === null && signal) {
          status = 'failed'
          errorMessage = `进程被信号终止：${signal}`
        } else if (exitCode !== 0) {
          status = 'failed'
          errorMessage = `退出码 ${exitCode}`
        }
        done({ status, exitCode, stdout, stderr, errorMessage })
      })
    })
  })
}
