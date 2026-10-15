// Lightweight assertions for pure helpers. Run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextCronDate, normalizeCron, validateCron } from '../src/scheduler.js'
import { encryptSecret, decryptSecret, getKey } from '../src/crypto.js'

test('normalizeCron keeps only 5 fields', () => {
  assert.equal(normalizeCron('0 2 * * * *'), '0 2 * * *')
  assert.equal(normalizeCron('  */5  *  *  *  * '), '*/5 * * * *')
})

test('validateCron accepts valid and rejects invalid', () => {
  assert.ok(validateCron('0 2 * * *'))
  assert.ok(validateCron('*/30 * * * *'))
  assert.equal(validateCron('not a cron'), false)
  assert.equal(validateCron(null), false)
})

test('nextCronDate: daily 02:00 uses local time and rolls forward', () => {
  // Cron matches wall-clock local time; assert on local components.
  const from = new Date('2026-01-01T03:00:00Z')
  const next = new Date(nextCronDate('0 2 * * *', from))
  assert.ok(next.getTime() > from.getTime())
  assert.equal(next.getHours(), 2)
  assert.equal(next.getMinutes(), 0)
  assert.equal(next.getSeconds(), 0)
})

test('nextCronDate: every 30 minutes', () => {
  const from = new Date('2026-01-01T10:10:00Z')
  const next = new Date(nextCronDate('*/30 * * * *', from))
  assert.equal(next.getMinutes() % 30, 0)
  assert.ok(next.getTime() > from.getTime())
})

test('encrypt/decrypt round trip', () => {
  const key = getKey('/tmp/ssh-manager-test-key-dir')
  const secret = 'p@ssw0rd-测试-🔐'
  const enc = encryptSecret(secret, key)
  assert.notEqual(enc, secret)
  assert.ok(enc.startsWith('v1:'))
  assert.equal(decryptSecret(enc, key), secret)
})

test('decrypt fails closed with wrong key', () => {
  const key = getKey('/tmp/ssh-manager-test-key-dir')
  const other = Buffer.alloc(32, 7)
  const enc = encryptSecret('top-secret', key)
  assert.equal(decryptSecret(enc, other), null)
})
