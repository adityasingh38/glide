import { useEffect, useState, useRef } from 'react'
import { X, Eye, EyeOff, Key, Zap, Clipboard, Monitor, CheckCircle, XCircle, Loader } from 'lucide-react'

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
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 — smarter' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — best' },
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
    // Flash "Saved" indicator
    setSaved(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setSaved(false), 1500)
  }

  async function runTest() {
    setTestStatus('loading')
    setTestError('')
    const result = await window.glide.testConnection()
    if (result.ok) {
      setTestStatus('ok')
      setTimeout(() => setTestStatus('idle'), 3000)
    } else {
      setTestStatus('err')
      setTestError(result.error ?? 'Unknown error')
    }
  }

  if (!s) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: accent }} />
    </div>
  )

  return (
    <div className="flex flex-col h-screen" style={{ background: 'rgba(30,30,30,0.82)' }}>

      {/* Title bar */}
      <div
        className="flex items-center justify-between pl-4 pr-1 h-10 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Glide
          </span>
          <span
            className="text-[11px] transition-opacity duration-300"
            style={{ color: 'rgba(255,255,255,0.4)', opacity: saved ? 1 : 0 }}
          >
            Saved ✓
          </span>
        </div>
        <button
          className="w-8 h-8 flex items-center justify-center rounded transition-colors cursor-pointer group"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => window.glide.closeWindow()}
        >
          <X size={12} className="text-white/40 group-hover:text-white transition-colors" />
        </button>
      </div>

      {/* Thin separator */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">

        {/* Enable */}
        <SettingRow
          label="Enable Glide"
          icon={<Zap size={14} />}
          accent={accent}
        >
          <Toggle checked={s.enabled} onChange={v => update({ enabled: v })} accent={accent} />
        </SettingRow>

        <Divider />

        {/* API Key */}
        <SectionLabel>Claude API</SectionLabel>

        <Card>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={s.apiKey}
                  onChange={e => update({ apiKey: e.target.value })}
                  placeholder="sk-ant-…"
                  className="pr-8"
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                  onClick={() => setShowKey(v => !v)}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Get one at <span style={{ color: accent }}>console.anthropic.com</span>
                </p>
                <button
                  onClick={runTest}
                  disabled={testStatus === 'loading' || !s.apiKey}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] cursor-pointer transition-all disabled:opacity-40"
                  style={{
                    background: testStatus === 'ok' ? 'rgba(34,197,94,0.15)' : testStatus === 'err' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${testStatus === 'ok' ? 'rgba(34,197,94,0.3)' : testStatus === 'err' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.12)'}`,
                    color: testStatus === 'ok' ? 'rgb(134,239,172)' : testStatus === 'err' ? 'rgb(252,165,165)' : 'rgba(255,255,255,0.6)'
                  }}
                >
                  {testStatus === 'loading' && <Loader size={10} className="animate-spin" />}
                  {testStatus === 'ok' && <CheckCircle size={10} />}
                  {testStatus === 'err' && <XCircle size={10} />}
                  {testStatus === 'idle' && 'Test'}
                  {testStatus === 'loading' && 'Testing…'}
                  {testStatus === 'ok' && 'Connected'}
                  {testStatus === 'err' && 'Failed'}
                </button>
              </div>
              {testStatus === 'err' && testError && (
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'rgba(252,165,165,0.8)' }}>
                  {testError.length > 120 ? testError.slice(0, 120) + '…' : testError}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>Model</label>
              <select value={s.model} onChange={e => update({ model: e.target.value })}>
                {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Divider />

        {/* Behaviour */}
        <SectionLabel>Behaviour</SectionLabel>

        <Card>
          <div className="space-y-4">
            <SettingRow
              label="Trigger"
              description="Auto predicts as you type. Manual only on Ctrl+Shift+Space."
              icon={<Key size={14} />}
              accent={accent}
            >
              <div className="flex rounded-md overflow-hidden text-[12px] shrink-0" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                {(['auto', 'manual'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => update({ trigger: t })}
                    className="px-3 py-1 capitalize cursor-pointer transition-colors"
                    style={s.trigger === t
                      ? { background: accent, color: '#fff' }
                      : { color: 'rgba(255,255,255,0.45)' }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </SettingRow>

            <SettingRow
              label={`Max tokens — ${s.maxTokens}`}
              description="Longer completions take more time."
              accent={accent}
            >
              <input
                type="range" min={10} max={80} step={5}
                value={s.maxTokens}
                onChange={e => update({ maxTokens: parseInt(e.target.value) })}
                className="w-24 shrink-0"
              />
            </SettingRow>
          </div>
        </Card>

        <Divider />

        {/* Context */}
        <SectionLabel>Context</SectionLabel>

        <Card>
          <div className="space-y-4">
            <SettingRow
              label="Clipboard Context"
              description="Reads your clipboard before each prediction."
              icon={<Clipboard size={14} />}
              accent={accent}
            >
              <Toggle checked={s.clipboardContext} onChange={v => update({ clipboardContext: v })} accent={accent} />
            </SettingRow>
            <SettingRow
              label="Screen Context"
              description="Captures your screen so Glide sees what you're looking at."
              icon={<Monitor size={14} />}
              accent={accent}
            >
              <Toggle checked={s.screenContext} onChange={v => update({ screenContext: v })} accent={accent} />
            </SettingRow>
          </div>
        </Card>

        <Divider />

        {/* Hotkeys */}
        <SectionLabel>Hotkeys</SectionLabel>

        <Card>
          <div className="space-y-2">
            <Hotkey keys={['Tab']} label="Accept suggestion" />
            <Hotkey keys={['Ctrl', 'Shift', 'Space']} label="Trigger manually" />
            <Hotkey keys={['Esc']} label="Dismiss" />
          </div>
        </Card>

      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 flex justify-between shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.25)' }}
      >
        <span>Glide · tray app</span>
        <span>adityasingh38</span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider"
       style={{ color: 'rgba(255,255,255,0.35)' }}>
      {children}
    </p>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {children}
    </div>
  )
}

function SettingRow({ label, description, icon, children, accent: _accent }: {
  label: string
  description?: string
  icon?: React.ReactNode
  children?: React.ReactNode
  accent?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span style={{ color: 'rgba(255,255,255,0.4)' }}>{icon}</span>}
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.88)' }}>{label}</p>
        </div>
        {description && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {description}
          </p>
        )}
      </div>
      {children && <div className="shrink-0 mt-0.5">{children}</div>}
    </div>
  )
}

function Toggle({ checked, onChange, accent }: { checked: boolean; onChange: (v: boolean) => void; accent: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative flex items-center w-10 h-[22px] rounded-full transition-all cursor-pointer shrink-0"
      style={{ background: checked ? accent : 'rgba(255,255,255,0.18)' }}
    >
      <span
        className="absolute w-[18px] h-[18px] rounded-full bg-white transition-transform"
        style={{
          transform: checked ? 'translateX(20px)' : 'translateX(2px)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }}
      />
    </button>
  )
}

function Hotkey({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span
            key={i}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.55)',
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
