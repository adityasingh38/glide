import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { log } from './log'

/**
 * Completions the user actually accepted.
 *
 * This is the cheapest personalisation signal there is: a Tab press is an
 * explicit "yes, that's my voice". Feeding a handful back as few-shot examples
 * teaches tone, vocabulary and formatting far better than any self-description,
 * and costs nothing to collect.
 */

export interface Accepted {
  before: string
  completion: string
  at: number
}

// Enough to establish a voice, few enough to stay cheap in the prompt
const KEEP = 40
const USE_IN_PROMPT = 6

let cache: Accepted[] | null = null

function file(): string {
  return join(app.getPath('userData'), 'accepted.json')
}

function load(): Accepted[] {
  if (cache) return cache
  try {
    let raw = readFileSync(file(), 'utf-8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache
}

export function recordAccepted(before: string, completion: string): void {
  const trimmed = completion.trim()
  if (!trimmed) return

  const list = load()
  // Keep only the tail of the preceding text — that's all the example needs
  list.push({ before: before.slice(-80), completion: trimmed, at: Date.now() })
  while (list.length > KEEP) list.shift()

  try {
    writeFileSync(file(), JSON.stringify(list, null, 2), 'utf-8')
    log(`learned: ${JSON.stringify(trimmed)} (${list.length} stored)`)
  } catch (e) {
    log('could not save accepted completion:', e instanceof Error ? e.message : String(e))
  }
}

/** The most recent accepted completions, for use as few-shot examples. */
export function recentExamples(): Array<{ before: string; completion: string }> {
  return load()
    .slice(-USE_IN_PROMPT)
    .map(({ before, completion }) => ({ before, completion }))
}

export function clearLearned(): void {
  cache = []
  try { writeFileSync(file(), '[]', 'utf-8') } catch { /* ignore */ }
}
