import { useEffect, useState, useRef } from 'react'
import { X, Eye, EyeOff, Zap, Clipboard, Monitor, CheckCircle, XCircle, Loader, ChevronDown } from 'lucide-react'

interface Settings {
  enabled: boolean
  apiKey: string
  model: string
  debounceMs: number
  maxTokens: number
  trigger: 'auto' | 'manual'
  clipboardContext: boolean
  screenContext: boolean
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
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
]

export default function App() {
  const [s, setS] = useState<Settings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [accent, setAccent] = useState('#0078d4')
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [testError, setTestError] = useState('')
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.glide.getSettings().then(setS)
    window.glide.getAccentColor().then(a => {
      setAccent(a)
      document.documentElement.style.setProperty('--accent', a)
    })
  }, [])

  async function update(patch: Partial<Settings>) {
    if (!s) return
    setS(prev => ({ ...prev!, ...patch }))
    await window.glide.setSettings(patch)
    setSaved(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setSaved(false), 1400)
  }

  async function runTest() {
    setTestStatus('loading')
    setTestError('')
    const result = await window.glide.testConnection()
    if (result.ok) {
      setTestStatus('ok')
      setTimeout(() => setTestStatus('idle'), 4000)
    } else {
      setTestStatus('err')
      setTestError(result.error ?? 'Unknown error')
    }
  }

  if (!s) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accent }} />
    </div>
  )

  return (
    <div className="flex flex-col h-screen select-none" style={{ background: 'rgba(22,22,22,0.86)' }}>

      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 44, WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: accent }}>
            <Zap size={11} color="#fff" strokeWidth={2.5} />
          </div>
          <span className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.01em' }}>
            Glide
          </span>
          <span
            className="text-[11px] transition-opacity duration-300"
            style={{ color: 'rgba(255,255,255,0.35)', opacity: saved ? 1 : 0 }}
          >
            saved
          </span>
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer"
          style={{ WebkitAppRegion: 'no-drag', color: 'rgba(255,255,255,0.35)' } as React.CSSProperties}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,80,80,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => window.glide.closeWindow()}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2" style={{ scrollbarWidth: 'none' }}>

        {/* Enable card */}
        <div className="rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: s.enabled ? `${accent}18` : 'rgba(255,255,255,0.04)', border: `1px solid ${s.enabled ? `${accent}30` : 'rgba(255,255,255,0.07)'}` }}>
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Enable Glide</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {s.enabled ? 'Predicting as you type' : 'Paused — no predictions'}
            </p>
          </div>
          <Toggle checked={s.enabled} onChange={v => update({ enabled: v })} accent={accent} />
        </div>

        {/* API card */}
        <Section label="Claude API">
          {/* Key input */}
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={s.apiKey}
              onChange={e => update({ apiKey: e.target.value })}
              placeholder="sk-ant-api03-…"
              className="w-full pr-8"
            />
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
              style={{ color: 'rgba(255,255,255,0.3)' }}
              onClick={() => setShowKey(v => !v)}
            >
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>

          {/* Model selector */}
          <div className="relative mt-2">
            <select
              value={s.model}
              onChange={e => update({ model: e.target.value })}
              className="w-full appearance-none pr-8"
            >
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,0.3)' }} />
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={runTest}
              disabled={testStatus === 'loading' || !s.apiKey}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all disabled:opacity-40"
              style={{
                background: testStatus === 'ok' ? 'rgba(34,197,94,0.12)' : testStatus === 'err' ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${testStatus === 'ok' ? 'rgba(34,197,94,0.25)' : testStatus === 'err' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.1)'}`,
                color: testStatus === 'ok' ? 'rgb(134,239,172)' : testStatus === 'err' ? 'rgb(252,165,165)' : 'rgba(255,255,255,0.55)'
              }}
            >
              {testStatus === 'loading' && <Loader size={11} className="animate-spin" />}
              {testStatus === 'ok' && <CheckCircle size={11} />}
              {testStatus === 'err' && <XCircle size={11} />}
              <span>
                {testStatus === 'idle' && 'Test connection'}
                {testStatus === 'loading' && 'Connecting…'}
                {testStatus === 'ok' && 'Connected'}
                {testStatus === 'err' && 'Failed'}
              </span>
            </button>
            {!s.apiKey && (
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Get a key at <span style={{ color: accent }}>console.anthropic.com</span>
              </span>
            )}
          </div>
          {testStatus === 'err' && testError && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'rgba(252,165,165,0.75)' }}>
              {testError.length > 100 ? testError.slice(0, 100) + '…' : testError}
            </p>
          )}
        </Section>

        {/* Context card */}
        <Section label="Context">
          <ContextRow
            icon={<Clipboard size={13} />}
            label="Clipboard"
            desc="Read clipboard before each prediction"
            checked={s.clipboardContext}
            onChange={v => update({ clipboardContext: v })}
            accent={accent}
          />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '10px 0' }} />
          <ContextRow
            icon={<Monitor size={13} />}
            label="Screen"
            desc="Capture screen for context"
            checked={s.screenContext}
            onChange={v => update({ screenContext: v })}
            accent={accent}
          />
        </Section>

        {/* Behaviour card */}
        <Section label="Behaviour">
          {/* Trigger */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.85)' }}>Trigger</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {s.trigger === 'auto' ? 'Predicts while you type' : 'Manual — Ctrl+Shift+Space'}
              </p>
            </div>
            <div className="flex text-[12px] rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
              {(['auto', 'manual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => update({ trigger: t })}
                  className="px-3 py-1.5 capitalize cursor-pointer font-medium transition-colors"
                  style={s.trigger === t
                    ? { background: accent, color: '#fff' }
                    : { color: 'rgba(255,255,255,0.4)', background: 'transparent' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '12px 0' }} />

          {/* Max tokens */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.85)' }}>Length</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.maxTokens} tokens max</p>
            </div>
            <input
              type="range" min={10} max={80} step={5}
              value={s.maxTokens}
              onChange={e => update({ maxTokens: parseInt(e.target.value) })}
              className="w-28 shrink-0"
            />
          </div>
        </Section>

        {/* Hotkeys */}
        <div className="px-1 pt-1">
          <p className="text-[11px] mb-2 font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>Hotkeys</p>
          <div className="space-y-2">
            <HotkeyRow label="Accept suggestion" keys={['Tab']} />
            <HotkeyRow label="Trigger manually" keys={['Ctrl', 'Shift', 'Space']} />
            <HotkeyRow label="Dismiss" keys={['Esc']} />
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 flex items-center justify-between shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>Glide · tray app</span>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>adityasingh38</span>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] px-1 mb-1.5 font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>
        {label}
      </p>
      <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {children}
      </div>
    </div>
  )
}

function ContextRow({ icon, label, desc, checked, onChange, accent }: {
  icon: React.ReactNode
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  accent: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span style={{ color: checked ? accent : 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.85)' }}>{label}</p>
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{desc}</p>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} accent={accent} />
    </div>
  )
}

function Toggle({ checked, onChange, accent }: { checked: boolean; onChange: (v: boolean) => void; accent: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative flex items-center w-9 h-5 rounded-full transition-all cursor-pointer shrink-0"
      style={{ background: checked ? accent : 'rgba(255,255,255,0.15)' }}
    >
      <span
        className="absolute w-4 h-4 rounded-full bg-white transition-transform"
        style={{
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
        }}
      />
    </button>
  )
}

function HotkeyRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span
            key={i}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.45)',
              fontFamily: "'Segoe UI', system-ui, sans-serif"
            }}
          >
            {k}
          </span>
        ))}
      </div>
    </div>
  )
}
