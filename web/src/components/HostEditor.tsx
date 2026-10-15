import { useEffect, useState } from 'react'
import type { Host } from '../types'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { useStore } from '../lib/store'

interface Props {
  host: Host | null
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey' | 'agent'
  password: string
  privateKey: string
  passphrase: string
  group: string
  tags: string
  favorite: boolean
}

const EMPTY: FormState = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  group: '',
  tags: '',
  favorite: false,
}

export function HostEditor({ host, onClose, onSaved }: Props) {
  const pushToast = useStore((s) => s.pushToast)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const isEdit = !!host

  useEffect(() => {
    if (host) {
      setForm({
        ...EMPTY,
        name: host.name,
        host: host.host,
        port: host.port,
        username: host.username,
        authType: host.authType,
        group: host.group || '',
        tags: host.tags.join(', '),
        favorite: host.favorite,
      })
    } else {
      setForm(EMPTY)
    }
  }, [host])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function save() {
    if (!form.name.trim()) return pushToast('error', '请填写名称')
    if (!form.host.trim()) return pushToast('error', '请填写主机地址')
    if (!form.username.trim()) return pushToast('error', '请填写用户名')
    if (!isEdit) {
      if (form.authType === 'password' && !form.password) return pushToast('error', '请填写密码')
      if (form.authType === 'privateKey' && !form.privateKey) return pushToast('error', '请填写私钥')
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      authType: form.authType,
      group: form.group.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      favorite: form.favorite,
    }
    if (form.password) payload.password = form.password
    if (form.privateKey) payload.privateKey = form.privateKey
    if (form.passphrase) payload.passphrase = form.passphrase

    setSaving(true)
    try {
      if (isEdit && host) await api.updateHost(host.id, payload)
      else await api.createHost(payload)
      pushToast('success', isEdit ? '已保存并重新探测' : '已添加主机')
      onSaved()
      onClose()
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `编辑主机 · ${host?.name}` : '添加 SSH 主机'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label>名称</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="production-web-01" />
        </div>
        <div className="field">
          <label>分组（可选）</label>
          <input className="input" value={form.group} onChange={(e) => set('group', e.target.value)} placeholder="生产环境" />
        </div>
      </div>

      <div className="grid3">
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>主机地址 / IP</label>
          <input className="input" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.1.20" />
        </div>
        <div className="field">
          <label>端口</label>
          <input className="input" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label>用户名</label>
          <input className="input" value={form.username} onChange={(e) => set('username', e.target.value)} />
        </div>
        <div className="field">
          <label>认证方式</label>
          <select className="select" value={form.authType} onChange={(e) => set('authType', e.target.value as FormState['authType'])}>
            <option value="password">密码</option>
            <option value="privateKey">私钥</option>
            <option value="agent">SSH Agent</option>
          </select>
        </div>
      </div>

      {form.authType === 'password' && (
        <div className="field">
          <label>密码 {isEdit && <span className="hint">（留空表示不修改）</span>}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </div>
      )}

      {form.authType === 'privateKey' && (
        <>
          <div className="field">
            <label>私钥内容 {isEdit && <span className="hint">（留空表示不修改）</span>}</label>
            <textarea
              className="textarea"
              value={form.privateKey}
              onChange={(e) => set('privateKey', e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </div>
          <div className="field">
            <label>私钥口令（可选）</label>
            <input className="input" type="password" value={form.passphrase} onChange={(e) => set('passphrase', e.target.value)} />
          </div>
        </>
      )}

      {form.authType === 'agent' && (
        <div className="hint">将使用服务器进程的 SSH_AUTH_SOCK 环境变量连接。请确保后端已加载对应私钥。</div>
      )}

      <div className="field" style={{ marginTop: 11 }}>
        <label>标签（逗号分隔）</label>
        <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="生产, web, nginx" />
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={form.favorite} onChange={(e) => set('favorite', e.target.checked)} />
        收藏此主机（置顶显示）
      </label>

      <div className="hint">
        凭据将以 AES-256-GCM 加密后存储，接口不会回传明文。首次连接会记录主机指纹，之后指纹变化将被拦截。
      </div>
    </Modal>
  )
}
