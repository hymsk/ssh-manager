import type { Host, Plan, Run, BatchOptions, BatchDraft, CommandTemplate, ProbeConfig } from '../types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`)
  }
  return data as T
}

export const api = {
  health: () => request<{ ok: boolean; probe: ProbeConfig; uptime: number }>('/health'),

  listHosts: () => request<{ hosts: Host[]; probe: ProbeConfig }>('/hosts'),
  createHost: (body: Record<string, unknown>) =>
    request<{ host: Host }>('/hosts', { method: 'POST', body: JSON.stringify(body) }),
  updateHost: (id: string, body: Record<string, unknown>) =>
    request<{ host: Host }>(`/hosts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteHost: (id: string) => request<{ ok: boolean }>(`/hosts/${id}`, { method: 'DELETE' }),
  probeHost: (id: string) => request<{ host: Host }>(`/hosts/${id}/probe`, { method: 'POST' }),
  testHost: (id: string) =>
    request<{ ok: boolean; latencyMs?: number; error?: string }>(`/hosts/${id}/test`, { method: 'POST' }),
  execOnHost: (id: string, command: string, timeoutSeconds = 60) =>
    request<{ status: string; exitCode: number | null; stdout: string; stderr: string; errorMessage: string | null; durationMs: number }>(
      `/hosts/${id}/exec`,
      { method: 'POST', body: JSON.stringify({ command, timeoutSeconds }) },
    ),

  listPlans: () => request<{ plans: Plan[] }>('/plans'),
  createPlan: (body: Record<string, unknown>) =>
    request<{ plan: Plan }>('/plans', { method: 'POST', body: JSON.stringify(body) }),
  updatePlan: (id: string, body: Record<string, unknown>) =>
    request<{ plan: Plan }>(`/plans/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePlan: (id: string) => request<{ ok: boolean }>(`/plans/${id}`, { method: 'DELETE' }),
  runPlan: (id: string) => request<{ runId: string }>(`/plans/${id}/run`, { method: 'POST' }),
  togglePlan: (id: string) => request<{ plan: Plan }>(`/plans/${id}/toggle`, { method: 'POST' }),
  previewCron: (cronExpression: string, count = 5) =>
    request<{ next: string[] }>('/plans/preview', { method: 'POST', body: JSON.stringify({ cronExpression, count }) }),

  listRuns: (limit = 50) => request<{ runs: Run[] }>(`/runs?limit=${limit}`),
  getRun: (id: string) => request<{ run: Run }>(`/runs/${id}`),
  startRun: (draft: BatchDraft) =>
    request<{ runId: string; skipped: { id: string; name: string }[] }>('/runs', {
      method: 'POST',
      body: JSON.stringify({
        name: draft.name,
        command: draft.command,
        type: draft.type,
        hostIds: draft.hostIds,
        options: draft.options,
      }),
    }),
  cancelRun: (id: string) => request<{ ok: boolean }>(`/runs/${id}/cancel`, { method: 'POST' }),
  retryFailed: (id: string) => request<{ runId: string | null; hostIds: string[] }>(`/runs/${id}/retry-failed`, { method: 'POST' }),
  retryHost: (id: string, hostId: string) =>
    request<{ runId: string }>(`/runs/${id}/retry-host`, { method: 'POST', body: JSON.stringify({ hostId }) }),
  clearRuns: (ids?: string[]) =>
    request<{ ok: boolean }>('/runs', { method: 'DELETE', body: JSON.stringify({ ids }) }),

  listTemplates: () => request<{ templates: CommandTemplate[] }>('/templates'),
}

export type { BatchOptions }
