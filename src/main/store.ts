import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export interface Settings {
  enabled: boolean
  apiKey: string
  model: string
  debounceMs: number
  maxTokens: number
  trigger: 'auto' | 'manual'
  clipboardContext: boolean
  screenContext: boolean
  /**
   * Free-text facts about the user, injected into the system prompt.
   * Without this, "my name is" makes the model introduce ITSELF — it sees a chat
   * on screen and assumes it's the speaker. Telling it who the human is fixes
   * that far better than any amount of prompt scolding.
   */
  userFacts: string
  theme: 'light' | 'dark'
  /**
   * Which engine answers a keystroke.
   *  cloud  — Claude only (~850ms, best quality, sees the screen)
   *  local  — on-device only (~30-76ms, no network, no vision)
   *  hybrid — local answers instantly, Claude upgrades it if you linger
   */
  engine: 'cloud' | 'local' | 'hybrid'
}

const defaults: Settings = {
  enabled: true,
  apiKey: '',
  // Haiku by default: measured 847ms to first token with a cached screenshot vs
  // 2042ms for Sonnet 5. For 2-8 word completions the quality difference is
  // negligible; the latency difference is the entire experience.
  model: 'claude-haiku-4-5-20251001',
  debounceMs: 0,
  maxTokens: 40,
  trigger: 'auto',
  clipboardContext: false,
  screenContext: false,
  userFacts: '',
  theme: 'dark',
  engine: 'hybrid'
}

/** Best-effort guess at the user's name so "my name is" works before they configure anything. */
function guessUserFacts(): string {
  const candidates: string[] = []
  try {
    const gitName = execFileSync('git', ['config', '--global', 'user.name'], {
      encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (gitName) candidates.push(gitName)
  } catch { /* git missing or unconfigured */ }

  if (candidates.length === 0) {
    const envName = process.env.USERNAME ?? process.env.USER ?? ''
    if (envName) candidates.push(envName)
  }

  return candidates.length ? `My name is ${candidates[0]}.` : ''
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

let cached: Settings | null = null

export function readSettings(): Settings {
  if (cached) return cached
  const path = settingsPath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    // No file yet — first run
    const fresh = { ...defaults }
    cached = fresh
    return fresh
  }

  // Strip a UTF-8 BOM if some editor (or PowerShell's Set-Content) added one.
  // JSON.parse rejects it, and silently falling back to defaults looks exactly
  // like "my API key disappeared".
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  let next: Settings
  try {
    next = { ...defaults, ...JSON.parse(raw) }
    // Seed a name on first run so introductions work out of the box
    if (!next.userFacts) next.userFacts = guessUserFacts()
  } catch (e) {
    // Loud, not silent — this used to wipe the visible config with no clue why.
    console.error(
      `[glide] settings.json at ${path} is not valid JSON, using defaults:`,
      e instanceof Error ? e.message : e
    )
    next = { ...defaults }
  }
  cached = next
  return next
}

export function writeSettings(patch: Partial<Settings>): void {
  const current = readSettings()
  cached = { ...current, ...patch }
  writeFileSync(settingsPath(), JSON.stringify(cached, null, 2), 'utf-8')
}
