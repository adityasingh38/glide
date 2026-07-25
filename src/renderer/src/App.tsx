import { useEffect, useState } from 'react'
import { X, Eye, EyeOff, Key, Zap, Clock } from 'lucide-react'

interface Settings {
  enabled: boolean
  apiKey: string
  model: string
  debounceMs: number
  maxTokens: number
  trigger: 'auto' | 'manual'
}

declare global {
  interface Window {
    glide: {
      getSettings: () => Promise<Settings>
      setSettings: (patch: Partial<Settings>) => Promise<void>
      closeWindow: () => void
    }
  }
}

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (smarter)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (best)' },
]

export default function App() {
  const [s, setS] = useState<Settings | null>(null)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => { window.glide.getSettings().then(setS) }, [])

  async function update(patch: Partial<Settings>) {
    if (!s) return
    setS(prev => ({ ...prev!, ...patch }))
    await window.glide.setSettings(patch)
  }

  if (!s) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-3 h-3 rounded-full bg-violet-500 animate-pulse" />
    </div>
  )

  return (
    <div className="flex flex-col h-screen">
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          <span className="text-sm font-semibold">Glide</span>
          <span className="text-[10px] text-zinc-500 font-mono bg-zinc-800 px-1.5 py-0.5 rounded">v0.1</span>
        </div>
        <button
          className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => window.glide.closeWindow()}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Enable */}
        <Card>
          <Row label="Enable Glide" icon={<Zap size={13} />}>
            <Toggle checked={s.enabled} onChange={v => update({ enabled: v })} />
          </Row>
        </Card>

        {/* API key */}
        <Card label="Claude API">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={s.apiKey}
                  onChange={e => update({ apiKey: e.target.value })}
                  placeholder="sk-ant-…"
                  className="pr-8"
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  onClick={() => setShowKey(v => !v)}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <p className="text-[11px] text-zinc-600 mt-1.5">
                Get one at <span className="text-violet-400">console.anthropic.com</span>
              </p>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Model</label>
              <select value={s.model} onChange={e => update({ model: e.target.value })}>
                {MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Behaviour */}
        <Card label="Behaviour">
          <div className="space-y-4">
            <Row
              label="Trigger"
              icon={<Key size={13} />}
              description="Auto: predicts after you pause typing. Manual: only on Ctrl+Shift+Space."
            >
              <div className="flex rounded-md overflow-hidden border border-zinc-700 text-xs shrink-0">
                {(['auto', 'manual'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => update({ trigger: t })}
                    className={`px-3 py-1.5 capitalize cursor-pointer transition-colors ${s.trigger === t ? 'bg-violet-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Row>

            <Row
              label={`Debounce — ${s.debounceMs}ms`}
              icon={<Clock size={13} />}
              description="How long after you stop typing before a prediction fires."
            >
              <input
                type="range" min={300} max={2000} step={100}
                value={s.debounceMs}
                onChange={e => update({ debounceMs: parseInt(e.target.value) })}
                className="w-28 shrink-0"
                disabled={s.trigger === 'manual'}
              />
            </Row>

            <Row
              label={`Max tokens — ${s.maxTokens}`}
              description="Max length of each completion (longer = slower)."
            >
              <input
                type="range" min={10} max={80} step={5}
                value={s.maxTokens}
                onChange={e => update({ maxTokens: parseInt(e.target.value) })}
                className="w-28 shrink-0"
              />
            </Row>
          </div>
        </Card>

        {/* Hotkeys */}
        <Card label="Hotkeys">
          <div className="space-y-2 text-xs text-zinc-400">
            <Hotkey keys={['Ctrl', 'Space']} label="Accept suggestion" />
            <Hotkey keys={['Ctrl', 'Shift', 'Space']} label="Trigger manually" />
            <Hotkey keys={['Esc']} label="Dismiss" />
          </div>
        </Card>
      </div>

      <div className="px-4 py-2.5 border-t border-zinc-800 text-[11px] text-zinc-600 flex justify-between">
        <span>Glide · tray app</span>
        <span>adityasingh38</span>
      </div>
    </div>
  )
}

function Card({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden">
      {label && (
        <div className="px-4 py-2 border-b border-zinc-800">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

function Row({ label, description, icon, children }: {
  label: string; description?: string; icon?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-zinc-500">{icon}</span>}
          <p className="text-sm text-zinc-200">{label}</p>
        </div>
        {description && <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children && <div className="shrink-0 mt-0.5">{children}</div>}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative flex items-center w-9 h-5 rounded-full transition-colors cursor-pointer ${checked ? 'bg-violet-600' : 'bg-zinc-700'}`}
    >
      <span className={`absolute w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Hotkey({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">{k}</span>
        ))}
      </div>
    </div>
  )
}
