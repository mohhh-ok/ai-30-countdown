import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../domain/types'
import { FrontStage } from './FrontStage'
import { TickLog } from './TickLog'

type ToggleResponse = { ok: boolean; running: boolean }

const POLL_INTERVAL_MS = 1500

export function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'front' | 'log'>('front')
  const pollRef = useRef<number | null>(null)

  const fetchState = async () => {
    const res = await fetch('/api/state')
    if (!res.ok) return
    const data = (await res.json()) as GameState
    setState(data)
    setRunning(data.running ?? false)
  }

  useEffect(() => {
    fetchState()
  }, [])

  // ポーリング: ワーカー稼働中は定期的に状態を取得
  useEffect(() => {
    if (running) {
      pollRef.current = window.setInterval(fetchState, POLL_INTERVAL_MS)
    } else if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [running])

  const toggleWorker = async () => {
    setBusy(true)
    try {
      const res = await fetch(running ? '/api/stop' : '/api/start', { method: 'POST' })
      const data = (await res.json()) as ToggleResponse
      setRunning(data.running)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!window.confirm('世界をはじめからやり直します。よろしいですか？')) return
    setBusy(true)
    try {
      const res = await fetch('/api/reset', { method: 'POST' })
      if (res.ok) {
        const data = (await res.json()) as GameState
        setState(data)
        setRunning(data.running ?? false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">あやかし</span>
          <span className="brand-sub">百鬼夜行シミュレータ</span>
        </div>
        <div className="controls">
          <div className="view-toggle">
            <button
              className={view === 'front' ? 'active' : ''}
              onClick={() => setView('front')}
            >
              舞台
            </button>
            <button
              className={view === 'log' ? 'active' : ''}
              onClick={() => setView('log')}
            >
              楽屋
            </button>
          </div>
          <div className="tick-display">
            {state ? `${state.day}日目` : '—'}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={running}
            className={`worker-switch ${running ? 'on' : 'off'}`}
            onClick={toggleWorker}
            disabled={busy}
          >
            <span className="worker-switch-label">ワーカー</span>
            <span className="worker-switch-track">
              <span className="worker-switch-knob" />
            </span>
            <span className="worker-switch-state">{running ? 'オン' : 'オフ'}</span>
          </button>
        </div>
      </header>

      <main className="main">
        {view === 'front' ? (
          <FrontStage state={state} />
        ) : (
          <TickLog state={state} />
        )}
      </main>

      <button
        type="button"
        className="reset-mini"
        onClick={reset}
        disabled={busy}
        title="世界をはじめからやり直す"
      >
        リセット
      </button>
    </div>
  )
}
