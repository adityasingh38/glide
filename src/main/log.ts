import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Synchronous file logger.
 *
 * console.log in a packaged/detached Electron main process goes to a
 * block-buffered stdout, so lines show up seconds late or not at all — useless
 * for debugging timing-sensitive keystroke behaviour. appendFileSync lands
 * immediately.
 */

let file: string | null = null

function target(): string {
  if (!file) {
    try {
      file = join(app.getPath('userData'), 'debug.log')
    } catch {
      // app not ready yet — fall back next to the build output
      file = join(__dirname, '..', '..', 'glide-debug.log')
    }
  }
  return file
}

export function log(...parts: unknown[]): void {
  const stamp = new Date().toISOString().slice(11, 23)
  const body = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  const line = `[${stamp}] ${body}\n`
  try {
    appendFileSync(target(), line)
  } catch (e) {
    // Surface it rather than hide it — a silent logger is worse than none
    console.error('[glide] LOG WRITE FAILED', target(), e instanceof Error ? e.message : e)
  }
  console.log(line.trimEnd())
}

export function logPath(): string {
  return target()
}
