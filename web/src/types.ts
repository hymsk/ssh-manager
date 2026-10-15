export type HostStatus =
  | 'unknown'
  | 'connecting'
  | 'online'
  | 'unstable'
  | 'offline'
  | 'auth_failed'
  | 'timeout'
  | 'error'

export interface Host {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey' | 'agent'
  group: string | null
  tags: string[]
  favorite: boolean
  hostFingerprint: string | null
  hasSecret: boolean
  hasPassphrase: boolean
  status: HostStatus
  latencyMs: number | null
  lastError: string | null
  lastCheckedAt: string | null
  lastOnlineAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

export type ResultStatus =
  | 'pending'
  | 'connecting'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'auth_failed'
  | 'disconnected'
  | 'offline'
  | 'error'
  | 'cancelled'
  | 'skipped'

export interface RunResult {
  id: string
  run_id: string
  host_id: string
  host_name: string
  status: ResultStatus
  exit_code: number | null
  stdout: string | null
  stderr: string | null
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  retry_count: number
}

export interface Run {
  id: string
  plan_id: string | null
  name: string
  command: string
  type: string
  trigger: string
  status: 'running' | 'success' | 'partial' | 'failed' | 'cancelled'
  total_hosts: number
  success_count: number
  failed_count: number
  skipped_count: number
  started_at: string
  finished_at: string | null
  options: RunOptions
  results?: RunResult[]
}

export interface RunOptions {
  concurrency: number
  timeoutSeconds: number
  retryCount: number
  continueOnError: boolean
  skipOffline: boolean
}

export interface Plan {
  id: string
  name: string
  description: string | null
  enabled: boolean
  hostIds: string[]
  command: string
  type: 'command' | 'script'
  scheduleType: 'manual' | 'cron' | 'interval'
  cronExpression: string | null
  intervalSeconds: number | null
  concurrency: number
  timeoutSeconds: number
  retryCount: number
  continueOnError: boolean
  skipOffline: boolean
  lastRunId: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TemplateVar {
  key: string
  label: string
  default: string
}

export interface CommandTemplate {
  id: string
  name: string
  category: string
  type: 'command' | 'script'
  command: string
  description: string
  variables?: TemplateVar[]
}

export interface ProbeConfig {
  intervalMs: number
  offlineAfterFailures: number
  connectTimeoutMs: number
  lastSweepAt: string | null
}

export interface BatchOptions {
  concurrency: number
  timeoutSeconds: number
  retryCount: number
  continueOnError: boolean
  skipOffline: boolean
}

export interface BatchDraft {
  name: string
  command: string
  type: 'command' | 'script'
  hostIds: string[]
  options: BatchOptions
}
