import { useEffect, useState } from 'react'
import { useStore } from './lib/store'
import { HostList } from './components/HostList'
import { PlanList } from './components/PlanList'
import { RunView } from './components/RunView'
import { RunsHistory } from './components/RunsHistory'
import { BatchComposer, SingleHostExecModal } from './components/BatchComposer'
import { TerminalView } from './components/TerminalView'
import { Toasts } from './components/Toasts'
import type { Host } from './types'

export default function App() {
  const init = useStore((s) => s.init)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const hosts = useStore((s) => s.hosts)
  const probe = useStore((s) => s.probe)
  const refreshHosts = useStore((s) => s.refreshHosts)

  const [terminalHost, setTerminalHost] = useState<Host | null>(null)
  const [execHost, setExecHost] = useState<Host | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  useEffect(() => {
    init()
  }, [init])

  const online = hosts.filter((h) => h.status === 'online').length
  const offline = hosts.filter((h) => ['offline', 'unstable', 'timeout', 'auth_failed', 'error'].includes(h.status)).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" />
          SSH Manager
        </div>
        <button className="btn sm ghost" onClick={() => setLeftOpen((v) => !v)} title="切换主机列表">
          {leftOpen ? '◀' : '▶'}
        </button>
        <button className="btn sm ghost" onClick={() => setRightOpen((v) => !v)} title="切换计划面板">
          {rightOpen ? '▶' : '◀'}
        </button>
        <span className="spacer" />
        <span className="stat">
          在线 <b style={{ color: 'var(--green)' }}>{online}</b>
        </span>
        <span className="stat">
          异常 <b style={{ color: offline ? 'var(--red)' : 'var(--text-dim)' }}>{offline}</b>
        </span>
        <span className="stat" title={`探测间隔 ${(probe?.intervalMs ?? 30000) / 1000} 秒`}>
          ● 每 {(probe?.intervalMs ?? 30000) / 1000}s 探测
        </span>
        <button className="btn sm" onClick={refreshHosts}>
          刷新状态
        </button>
      </header>

      <div className="workspace">
        {leftOpen && (
          <aside className="col-left">
            <HostList onOpenTerminal={setTerminalHost} onOpenHostExec={setExecHost} />
          </aside>
        )}

        <main className="col-center">
          <div className="tabs">
            <button className={`tab${panel === 'terminal' ? ' active' : ''}`} onClick={() => setPanel('terminal')}>
              终端
            </button>
            <button className={`tab${panel === 'batch' ? ' active' : ''}`} onClick={() => setPanel('batch')}>
              批量执行
            </button>
            <button className={`tab${panel === 'run' ? ' active' : ''}`} onClick={() => setPanel('run')}>
              执行状态
            </button>
            <button className={`tab${panel === 'runs' ? ' active' : ''}`} onClick={() => setPanel('runs')}>
              执行记录
            </button>
          </div>

          {panel === 'terminal' &&
            (terminalHost ? (
              <TerminalView host={terminalHost} onClose={() => setTerminalHost(null)} />
            ) : (
              <div className="empty">
                <div className="big">▶_</div>
                <div>未打开终端</div>
                <div style={{ fontSize: 12 }}>在左侧主机卡片点击「终端」</div>
              </div>
            ))}

          {panel === 'batch' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <BatchComposer />
            </div>
          )}

          {panel === 'run' && <RunView />}

          {panel === 'runs' && <RunsHistory />}
        </main>

        {rightOpen && (
          <aside className="col-right">
            <PlanList />
          </aside>
        )}
      </div>

      <Toasts />

      {execHost && <SingleHostExecModal hostId={execHost.id} onClose={() => setExecHost(null)} />}
    </div>
  )
}
