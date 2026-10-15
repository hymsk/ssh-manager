import type { HostStatus, ResultStatus } from '../types'

export const HOST_STATUS_LABEL: Record<HostStatus, string> = {
  unknown: '未知',
  connecting: '探测中',
  online: '在线',
  unstable: '不稳定',
  offline: '离线',
  auth_failed: '认证失败',
  timeout: '超时',
  error: '异常',
}

export const RESULT_STATUS_LABEL: Record<ResultStatus, string> = {
  pending: '等待中',
  connecting: '连接中',
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  auth_failed: '认证失败',
  disconnected: '连接中断',
  offline: '离线',
  error: '异常',
  cancelled: '已取消',
  skipped: '已跳过',
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: '执行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return '即将执行'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s} 秒后`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟后`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时后`
  return `${Math.floor(h / 24)} 天后`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function scheduleText(plan: {
  scheduleType: string
  cronExpression: string | null
  intervalSeconds: number | null
}): string {
  if (plan.scheduleType === 'cron') return `Cron: ${plan.cronExpression || '—'}`
  if (plan.scheduleType === 'interval') {
    const s = plan.intervalSeconds || 0
    if (s < 60) return `每 ${s} 秒`
    if (s < 3600) return `每 ${Math.round(s / 60)} 分钟`
    return `每 ${Math.round(s / 3600)} 小时`
  }
  return '仅手动执行'
}

/** RFC4180-ish CSV cell escaping for log export. */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}
