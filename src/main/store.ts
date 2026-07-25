import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface Settings {
  enabled: boolean
  apiKey: string
  model: string
  debounceMs: number
  maxTokens: number
  trigger: 'auto' | 'manual'
  clipboardContext: boolean
  screenContext: boolean
}

const defaults: Settings = {
  enabled: true,
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  debounceMs: 800,
  maxTokens: 40,
  trigger: 'auto',
  clipboardContext: false,
  screenContext: false
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

let cached: Settings | null = null

export function readSettings(): Settings {
  if (cached) return cached
  try {
    cached = { ...defaults, ...JSON.parse(readFileSync(settingsPath(), 'utf-8')) }
  } catch {
    cached = { ...defaults }
  }
  return cached!
}

export function writeSettings(patch: Partial<Settings>): void {
  const current = readSettings()
  cached = { ...current, ...patch }
  writeFileSync(settingsPath(), JSON.stringify(cached, null, 2), 'utf-8')
}
