import { create } from 'zustand'
import { api } from '../lib/api'
import { ws, type ServerEvent, type RunHostEvent } from '../lib/ws'
import type { Host, Plan, Run, RunResult, CommandTemplate, ProbeConfig, BatchDraft } from '../types'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error' | 'warn'
  message: string
}

interface AppState {
  hosts: Host[]
  plans: Plan[]
  runs: Run[]
  templates: CommandTemplate[]
  probe: ProbeConfig | null
  activeRun: Run | null
  runResults: Record<string, RunResult>
  loading: boolean
  toasts: Toast[]

  selectedHostIds: string[]
  panel: 'terminal' | 'batch' | 'host' | 'run' | 'runs' | 'plan'

  init: () => Promise<void>
  refreshHosts: () => Promise<void>
  refreshPlans: () => Promise<void>
  refreshRuns: () => Promise<void>
  loadRun: (id: string) => Promise<void>

  toggleSelect: (id: string) => void
  selectMany: (ids: string[]) => void
  clearSelection: () => void
  setPanel: (panel: AppState['panel']) => void

  startBatch: (draft: BatchDraft) => Promise<string | null>
  cancelActiveRun: () => Promise<void>
  retryFailed: () => Promise<void>
  retryHost: (hostId: string) => Promise<void>

  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
}

export const useStore = create<AppState>((set, get) => ({
  hosts: [],
  plans: [],
  runs: [],
  templates: [],
  probe: null,
  activeRun: null,
  runResults: {},
  loading: false,
  toasts: [],
  selectedHostIds: [],
  panel: 'terminal',

  init: async () => {
    set({ loading: true })
    await Promise.all([get().refreshHosts(), get().refreshPlans(), get().refreshRuns(), loadTemplates()])
    set({ loading: false })
    ws.connect()
    ws.onEvent((evt) => handleEvent(evt, set, get))
  },

  refreshHosts: async () => {
    const { hosts, probe } = await api.listHosts()
    set({ hosts, probe })
  },
  refreshPlans: async () => {
    const { plans } = await api.listPlans()
    set({ plans })
  },
  refreshRuns: async () => {
    const { runs } = await api.listRuns()
    set({ runs })
  },
  loadRun: async (id) => {
    const { run } = await api.getRun(id)
    const results: Record<string, RunResult> = {}
    for (const r of run.results || []) results[r.host_id] = r
    set({ activeRun: run, runResults: results, panel: 'run' })
  },

  toggleSelect: (id) => {
    const selected = get().selectedHostIds
    set({
      selectedHostIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    })
  },
  selectMany: (ids) => set({ selectedHostIds: ids }),
  clearSelection: () => set({ selectedHostIds: [] }),
  setPanel: (panel) => set({ panel }),

  startBatch: async (draft) => {
    try {
      const { runId, skipped } = await api.startRun(draft)
      if (skipped?.length) {
        get().pushToast('warn', `${skipped.length} 台离线主机已跳过`)
      }
      await get().loadRun(runId)
      await get().refreshRuns()
      get().pushToast('success', '任务已开始执行')
      return runId
    } catch (err) {
      get().pushToast('error', (err as Error).message)
      return null
    }
  },

  cancelActiveRun: async () => {
    const run = get().activeRun
    if (!run) return
    await api.cancelRun(run.id)
    get().pushToast('warn', '已请求取消任务')
  },

  retryFailed: async () => {
    const run = get().activeRun
    if (!run) return
    const { runId } = await api.retryFailed(run.id)
    if (!runId) {
      get().pushToast('info', '没有需要重试的主机')
      return
    }
    await get().loadRun(runId)
    await get().refreshRuns()
    get().pushToast('success', '已重试失败主机')
  },

  retryHost: async (hostId) => {
    const run = get().activeRun
    if (!run) return
    const { runId } = await api.retryHost(run.id, hostId)
    await get().loadRun(runId)
    await get().refreshRuns()
  },

  pushToast: (kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set({ toasts: [...get().toasts, { id, kind, message }] })
    setTimeout(() => get().dismissToast(id), 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

async function loadTemplates() {
  const { templates } = await api.listTemplates()
  useStore.setState({ templates })
}

/** Apply a server-pushed event to the store. */
function handleEvent(evt: ServerEvent, set: (p: Partial<AppState>) => void, get: () => AppState) {
  const payload = evt.payload as Record<string, unknown>
  switch (evt.type) {
    case 'host_status':
    case 'host_created':
    case 'host_updated': {
      const host = (evt.type === 'host_status' ? payload.host : payload) as Host | undefined
      if (!host?.id) return
      const hosts = get().hosts.map((h) => (h.id === host.id ? { ...h, ...host } : h))
      // New host created via another client.
      if (!hosts.some((h) => h.id === host.id)) hosts.push(host)
      set({ hosts })
      return
    }
    case 'host_deleted': {
      const id = payload.id as string
      set({ hosts: get().hosts.filter((h) => h.id !== id) })
      return
    }
    case 'run_started': {
      get().refreshRuns()
      return
    }
    case 'run_host': {
      const e = payload as unknown as RunHostEvent
      const results = { ...get().runResults, [e.result.host_id]: e.result }
      const activeRun = get().activeRun
      if (activeRun && activeRun.id === e.runId) {
        set({
          runResults: results,
          activeRun: { ...activeRun, ...e.counts } as Run,
        })
      } else {
        set({ runResults: results })
      }
      return
    }
    case 'run_finished': {
      const activeRun = get().activeRun
      if (activeRun && activeRun.id === (payload as unknown as Run).id) {
        set({ activeRun: { ...activeRun, ...(payload as unknown as Run) } })
      }
      get().refreshRuns()
      return
    }
    case 'plan_error': {
      get().pushToast('error', `计划执行失败：${payload.message}`)
      return
    }
    default:
      return
  }
}

export type { Host, Plan, Run }
