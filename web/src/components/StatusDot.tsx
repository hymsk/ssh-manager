import type { HostStatus, ResultStatus } from '../types'
import { HOST_STATUS_LABEL, RESULT_STATUS_LABEL } from '../lib/format'

interface Props {
  status: HostStatus | ResultStatus
  /** Controls the colour palette: host probing states vs execution results. */
  kind?: 'host' | 'result'
}

export function StatusDot({ status, kind = 'host' }: Props) {
  const label =
    kind === 'result'
      ? (RESULT_STATUS_LABEL as Record<string, string>)[status] ?? status
      : (HOST_STATUS_LABEL as Record<string, string>)[status] ?? status

  let cls: string
  if (kind === 'result') {
    // A result-side "offline" means the host could not be reached → treat as failure.
    cls = status === 'offline' ? 'st-failed' : `st-${status}`
  } else {
    cls = `st-${status}`
  }

  return (
    <span className={`status ${cls}`} title={label}>
      <span className="dot" />
      {label}
    </span>
  )
}
