import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const KEY_FILE = 'key'
let cachedKey = null

/** Resolve the 32-byte master key. Priority: env -> key file -> generate. */
export function getKey(dataDir) {
  if (cachedKey) return cachedKey

  const fromEnv = process.env.SSH_MANAGER_KEY
  if (fromEnv && fromEnv.trim()) {
    cachedKey = normalizeKey(fromEnv.trim())
    return cachedKey
  }

  const keyPath = path.join(dataDir, KEY_FILE)
  if (fs.existsSync(keyPath)) {
    cachedKey = normalizeKey(fs.readFileSync(keyPath, 'utf8').trim())
    return cachedKey
  }

  const generated = crypto.randomBytes(32)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 })
  try {
    fs.chmodSync(keyPath, 0o600)
  } catch {
    /* best effort on non-POSIX filesystems */
  }
  cachedKey = generated
  return cachedKey
}

function normalizeKey(raw) {
  let buf
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex')
  else buf = Buffer.from(raw, 'base64')

  if (buf.length !== 32) {
    // Derive a stable key from an arbitrary passphrase.
    return crypto.createHash('sha256').update(raw).digest()
  }
  return buf
}

/** Encrypt a UTF-8 secret. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
export function encryptSecret(plain, key) {
  if (plain == null || plain === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

/** Decrypt a value produced by encryptSecret. Returns null on failure. */
export function decryptSecret(payload, key) {
  if (!payload) return null
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':')
    if (version !== 'v1') return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
