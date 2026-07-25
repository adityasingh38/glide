import { useEffect, useState, useRef } from 'react'
import { X, Eye, EyeOff, SlidersHorizontal, Keyboard, Clipboard, Monitor, Sun, Moon, Check } from 'lucide-react'

/**
 * Glide's mark: a caret followed by fading ghost text — literally what the app
 * does. Drawn inline so there's no asset to load or theme to fight.
 */
function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="glideMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF9A5A" />
          <stop offset="55%" stopColor="#F05A28" />
          <stop offset="100%" stopColor="#D83F97" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#glideMark)" />
      {/* caret */}
      <rect x="7.5" y="8" width="2.6" height="16" rx="1.3" fill="#fff" />
      {/* ghost text trailing off */}
      <rect x="13" y="11" width="12" height="2.6" rx="1.3" fill="#fff" opacity="0.9" />
      <rect x="13" y="16" width="9"  height="2.6" rx="1.3" fill="#fff" opacity="0.6" />
      <rect x="13" y="21" width="5.5" height="2.6" rx="1.3" fill="#fff" opacity="0.32" />
    </svg>
  )
}

interface Settings {
  enabled: boolean
  apiKey: string
  model: string
  debounceMs: number
  maxTokens: number
  trigger: 'auto' | 'manual'
  clipboardContext: boolean
  screenContext: boolean
  userFacts: string
  theme: 'light' | 'dark'
}

declare global {
  interface Window {
    glide: {
      getSettings: () => Promise<Settings>
      setSettings: (patch: Partial<Settings>) => Promise<void>
      closeWindow: () => void
      getAccentColor: () => Promise<string>
      testConnection: () => Promise<{ ok: boolean; error?: string }>
      onSuggestionUpdate: (cb: (text: string) => void) => void
      onSuggestionAppend: (cb: (token: string) => void) => void
    }
  }
}

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5',  note: 'Fastest',  grad: 'grad-a', bars: [3, 1, 1] },
  { id: 'claude-sonnet-4-5',         name: 'Sonnet 4.5', note: 'Balanced', grad: 'grad-b', bars: [2, 2, 2] },
  { id: 'claude-sonnet-5',           name: 'Sonnet 5',   note: 'Smartest', grad: 'grad-c', bars: [1, 2, 3] },
]

type Tab = 'general' | 'hotkeys'

export default function App() {
  const [s, setS] = useState<Settings | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [showKey, setShowKey] = useState(false)
  const [conn, setConn] = useState<'unknown' | 'testing' | 'ok' | 'err'>('unknown')
  const [connErr, setConnErr] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Personal facts save separately — an explicit button, so you can tell it landed
  const [factsDraft, setFactsDraft] = useState('')
  const [factsSaved, setFactsSaved] = useState(false)

  useEffect(() => {
    window.glide.getSettings().then(v => {
      setS(v)
      setFactsDraft(v.userFacts ?? '')
      document.documentElement.dataset.theme = v.theme ?? 'dark'
      if (v.apiKey) runTest()
    })
  }, [])

  function setTheme(theme: 'light' | 'dark') {
    document.documentElement.dataset.theme = theme
    update({ theme })
  }

  function saveFacts() {
    update({ userFacts: factsDraft })
    setFactsSaved(true)
    setTimeout(() => setFactsSaved(false), 1600)
  }

  function update(patch: Partial<Settings>) {
    setS(prev => (prev ? { ...prev, ...patch } : prev))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.glide.setSettings(patch), 80)
  }

  async function runTest() {
    setConn('testing'); setConnErr('')
    const r = await window.glide.testConnection()
    if (r.ok) setConn('ok')
    else { setConn('err'); setConnErr(r.error ?? 'Unknown error') }
  }

  if (!s) return <div className="panel"><div className="boot"><span /></div></div>

  const keyStatus =
    conn === 'ok'      ? <span className="stat stat--ok">Connected</span> :
    conn === 'err'     ? <span className="stat stat--err">Connection failed</span> :
    conn === 'testing' ? <span className="stat stat--dim">Checking…</span> :
    s.apiKey           ? <button className="stat stat--link" onClick={runTest}>Test connection</button> :
                         <span className="stat stat--dim">Paste your Anthropic API key</span>

  return (
    <div className="panel">

      {/* Header — draggable */}
      <header className="head" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="brand">
          <Logo />
          <div>
            <h1 className="h1">Glide</h1>
            <p className="sub">Inline AI predictions, anywhere you type</p>
          </div>
        </div>
        <div className="head-actions" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            className="icon-btn"
            title={s.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            onClick={() => setTheme(s.theme === 'dark' ? 'light' : 'dark')}
          >
            {s.theme === 'dark' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
          </button>
          <button className="icon-btn" title="Close" onClick={() => window.glide.closeWindow()}>
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab${tab === 'general' ? ' tab--on' : ''}`} onClick={() => setTab('general')}>
          <SlidersHorizontal size={13} strokeWidth={2} /> General
        </button>
        <button className={`tab${tab === 'hotkeys' ? ' tab--on' : ''}`} onClick={() => setTab('hotkeys')}>
          <Keyboard size={13} strokeWidth={2} /> Hotkeys
        </button>
      </div>

      <div className="body">
        {tab === 'general' ? (
          <>
            <Row label="Enable Glide" desc={s.enabled ? 'Active across all apps' : 'Paused'}>
              <Toggle on={s.enabled} set={v => update({ enabled: v })} />
            </Row>

            <Row label="API key" descNode={keyStatus}>
              <div className="key-pill">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={s.apiKey}
                  onChange={e => { update({ apiKey: e.target.value }); setConn('unknown') }}
                  placeholder="sk-ant-…"
                  spellCheck={false}
                />
                <button onClick={() => setShowKey(v => !v)}>
                  {showKey ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
                </button>
              </div>
            </Row>
            {conn === 'err' && connErr && (
              <p className="err">{connErr.length > 110 ? connErr.slice(0, 110) + '…' : connErr}</p>
            )}

            <Row label="Model" desc="Which Claude model writes the prediction" />
            <div className="cards">
              {MODELS.map(m => {
                const on = s.model === m.id
                return (
                  <button key={m.id} className={`card${on ? ' card--on' : ''}`} onClick={() => update({ model: m.id })}>
                    <div className={`thumb ${m.grad}`}>
                      {m.bars.map((w, i) => (
                        <span key={i} className="tbar" style={{ width: `${28 + w * 18}%` }} />
                      ))}
                    </div>
                    <div className="cfoot">
                      <div>
                        <p className="cname">{m.name}</p>
                        <p className="cnote">{m.note}</p>
                      </div>
                      <span className={`radio${on ? ' radio--on' : ''}`} />
                    </div>
                  </button>
                )
              })}
            </div>

            <Row label="Trigger" desc={s.trigger === 'auto' ? 'Predicts as you type' : 'Only on Ctrl+Shift+Space'}>
              <div className="seg">
                {(['auto', 'manual'] as const).map(t => (
                  <button key={t} className={`sbtn${s.trigger === t ? ' sbtn--on' : ''}`} onClick={() => update({ trigger: t })}>
                    {t === 'auto' ? 'Auto' : 'Manual'}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Completion length" desc={`Up to ${s.maxTokens} tokens`}>
              <div className="sliderwrap">
                <input
                  type="range" min={10} max={80} step={5}
                  value={s.maxTokens}
                  onChange={e => update({ maxTokens: parseInt(e.target.value) })}
                  style={{ '--fill': `${((s.maxTokens - 10) / 70) * 100}%` } as React.CSSProperties}
                />
              </div>
            </Row>

            <p className="grouplabel">About you</p>

            <Row
              label="Personal facts"
              desc="Used when you write about yourself — e.g. “my name is”"
            />
            <textarea
              className="facts"
              value={factsDraft}
              onChange={e => setFactsDraft(e.target.value)}
              onKeyDown={e => {
                // Ctrl+Enter saves, since Enter has to stay a newline here
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveFacts() }
              }}
              placeholder={'My name is …\nI work at …\nI\'m building …'}
              spellCheck={false}
              rows={4}
            />
            <div className="facts-actions">
              <button
                className="btn-primary"
                onClick={saveFacts}
                disabled={factsDraft === (s.userFacts ?? '')}
              >
                {factsSaved ? <><Check size={12} strokeWidth={3} /> Saved</> : 'Update facts'}
              </button>
              {factsDraft !== (s.userFacts ?? '') && (
                <button className="btn-ghost" onClick={() => setFactsDraft(s.userFacts ?? '')}>Revert</button>
              )}
            </div>

            <p className="grouplabel">Context Glide can read</p>

            <Row icon={<Clipboard size={14} strokeWidth={1.9} />} label="Clipboard" desc="Include clipboard text in each prediction">
              <Toggle on={s.clipboardContext} set={v => update({ clipboardContext: v })} />
            </Row>

            <Row icon={<Monitor size={14} strokeWidth={1.9} />} label="Screen" desc="Let Glide see what's on screen">
              <Toggle on={s.screenContext} set={v => update({ screenContext: v })} />
            </Row>
          </>
        ) : (
          <>
            <Row label="Accept suggestion" desc="Completes the greyed-out text inline">
              <Keys k={['Tab']} />
            </Row>
            <Row label="Trigger manually" desc="Force a prediction right now">
              <Keys k={['Ctrl', 'Shift', 'Space']} />
            </Row>
            <Row label="Dismiss" desc="Hide the current suggestion">
              <Keys k={['Esc']} />
            </Row>
            <Row label="Open settings" desc="From the Glide tray icon">
              <Keys k={['Tray', '→', 'Settings']} />
            </Row>
          </>
        )}
      </div>

      <footer className="foot">
        <span className="spacer" />
        <span>v0.1.0</span>
      </footer>
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────── */

function Row({ label, desc, descNode, icon, children }: {
  label: string
  desc?: string
  descNode?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="row">
      {icon && <span className="rowicon">{icon}</span>}
      <div className="rowtext">
        <p className="rlabel">{label}</p>
        {descNode ? <div className="rdesc">{descNode}</div> : desc ? <p className="rdesc">{desc}</p> : null}
      </div>
      {children && <div className="rowctl">{children}</div>}
    </div>
  )
}

function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button className={`sw${on ? ' sw--on' : ''}`} onClick={() => set(!on)} aria-pressed={on}>
      <span className="knob" />
    </button>
  )
}

function Keys({ k }: { k: string[] }) {
  return <div className="keys">{k.map((x, i) => <kbd key={i}>{x}</kbd>)}</div>
}
