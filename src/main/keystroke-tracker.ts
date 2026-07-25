import { uIOhook, UiohookKey } from 'uiohook-napi'
import { globalShortcut, clipboard } from 'electron'
import { streamCompletion, type CompletionContext } from './claude-client'
import { showSuggestion, appendSuggestion, hideSuggestion } from './suggestion-window'
import { getScreenFrame, refreshScreenFrame } from './screen-context'
import { recordAccepted, recentExamples } from './learned'
import { completeLocal, isLocalReady } from './local-model'
import { readSettings } from './store'
import { sendCtrlV, getActiveWindowTitle, getForegroundWindowId, nudgeAccessibility, getFocusedFieldText } from './win32'
import { log } from './log'

let buffer = ''
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let streamController: AbortController | null = null
let currentSuggestion = ''
let suggestionVisible = false
let tabRegistered = false
let lastWindowId = ''

// Buffer contents at the moment the in-flight request was sent. Everything typed
// since is reconciled against the suggestion rather than cancelling it.
let predictedFrom: string | null = null

// Short, because in-flight requests are no longer cancelled by typing — they're
// reconciled. The old 280ms was there to protect a cancel-on-keystroke design
// that could never complete anyway.
const DEBOUNCE_MS = 110

// Typing older than this is stale context — a different sentence, probably a
// different field. Without this the buffer accumulates every stray keystroke
// ever typed in the window and the model pattern-matches the junk.
// Long enough to survive thinking mid-sentence, reading a suggestion, or glancing
// away. 6s was shorter than the time it takes to notice a 2s suggestion arrive,
// so the buffer kept vanishing while the user waited for one.
const IDLE_RESET_MS = 45_000
let lastKeyAt = 0

// Don't guess from one or two words — there isn't enough to go on and the
// suggestion is usually noise. Wait for a third word, then predict from there on.
const MIN_WORDS = 3

function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g)
  return m ? m.length : 0
}

function registerTab(): void {
  if (tabRegistered) return
  try {
    globalShortcut.register('Tab', () => acceptSuggestion())
    tabRegistered = true
  } catch {}
}

function unregisterTab(): void {
  if (!tabRegistered) return
  try {
    globalShortcut.unregister('Tab')
    tabRegistered = false
  } catch {}
}

// uiohook keycodes follow the physical scancode layout, NOT alphabetical order
// (Q=16, A=30, Z=44), so arithmetic like `keycode - UiohookKey.A + 97` produces
// garbage — it silently mapped S→b, D→c, F→d and dropped every key outside
// 30..44. Build an explicit table from the constants instead.
const LETTER_BY_KEYCODE: Record<number, string> = (() => {
  const map: Record<number, string> = {}
  const keys = UiohookKey as unknown as Record<string, number>
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const code = keys[ch.toUpperCase()]
    if (typeof code === 'number') map[code] = ch
  }
  return map
})()

// Map UiohookKey codes to printable chars (shift-aware for common keys)
function keycodeToChar(keycode: number, shift: boolean): string {
  // Letters
  const letter = LETTER_BY_KEYCODE[keycode]
  if (letter) return shift ? letter.toUpperCase() : letter

  // Digits row
  const digitMap: Record<number, [string, string]> = {
    [UiohookKey['0']]: ['0', ')'],
    [UiohookKey['1']]: ['1', '!'],
    [UiohookKey['2']]: ['2', '@'],
    [UiohookKey['3']]: ['3', '#'],
    [UiohookKey['4']]: ['4', '$'],
    [UiohookKey['5']]: ['5', '%'],
    [UiohookKey['6']]: ['6', '^'],
    [UiohookKey['7']]: ['7', '&'],
    [UiohookKey['8']]: ['8', '*'],
    [UiohookKey['9']]: ['9', '(']
  }
  if (keycode in digitMap) return digitMap[keycode][shift ? 1 : 0]

  // Punctuation
  const punctMap: Record<number, [string, string]> = {
    [UiohookKey.Space]: [' ', ' '],
    [UiohookKey.Comma]: [',', '<'],
    [UiohookKey.Period]: ['.', '>'],
    [UiohookKey.Slash]: ['/', '?'],
    [UiohookKey.Semicolon]: [';', ':'],
    [UiohookKey.Quote]: ["'", '"'],
    [UiohookKey.BracketLeft]: ['[', '{'],
    [UiohookKey.BracketRight]: [']', '}'],
    [UiohookKey.Backslash]: ['\\', '|'],
    [UiohookKey.Backquote]: ['`', '~'],
    [UiohookKey.Equal]: ['=', '+'],
    [UiohookKey.Minus]: ['-', '_']
  }
  if (keycode in punctMap) return punctMap[keycode][shift ? 1 : 0]

  return ''
}

function resetBuffer(reason?: string): void {
  if (reason) log('reset:', reason)
  buffer = ''
  abortStream()
  clearTimer()
  clearSuggestion()
}

function clearTimer(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
}

function abortStream(): void {
  if (streamController) { streamController.abort(); streamController = null }
  predictedFrom = null
}

function clearSuggestion(): void {
  hideSuggestion()
  suggestionVisible = false
  currentSuggestion = ''
  // MUST drop this too. Leaving it set with an empty suggestion made every later
  // keystroke reconcile as "waiting" and return before scheduling a prediction —
  // a deadlock that silently stopped all predictions until the next reset.
  predictedFrom = null
  unregisterTab()
}

function schedulePrediction(): void {
  clearTimer()
  debounceTimer = setTimeout(() => triggerPrediction(), DEBOUNCE_MS)
}

/**
 * Reconcile a streaming suggestion against typing that happened after the
 * request was sent.
 *
 * A prediction needs ~1500-2000ms for its first token; people type every ~150ms.
 * Cancelling per keystroke meant no request ever survived. So we keep the
 * request and work out how much of it the user has already typed themselves.
 *
 * Three outcomes, and the third one matters:
 *  - show     : the untyped remainder is ready to display
 *  - waiting  : consistent so far, but the stream is BEHIND the typing — we have
 *               "t" while they've typed "tion". Keep streaming; do NOT discard.
 *  - diverged : they genuinely typed something else.
 */
type Reconciled =
  | { state: 'show'; text: string }
  | { state: 'waiting' }
  | { state: 'diverged' }

function reconcile(requestedFrom: string, suggestion: string, buf: string): Reconciled {
  if (!buf.startsWith(requestedFrom)) return { state: 'diverged' }

  const typedSince = buf.slice(requestedFrom.length)
  if (typedSince.length === 0) {
    return suggestion ? { state: 'show', text: suggestion } : { state: 'waiting' }
  }
  if (!suggestion) return { state: 'waiting' }   // nothing streamed yet

  // The model is told not to emit a leading space, but the user types one at a
  // word boundary. Whether a space belongs can't be known up front — "the
  // weather is" needs one, mid-word "no sugges" must not have one — so try both
  // and keep whichever is consistent with what was actually typed.
  let waiting = false
  for (const cand of [suggestion, ' ' + suggestion]) {
    if (cand.startsWith(typedSince)) {
      const rest = cand.slice(typedSince.length)
      return rest ? { state: 'show', text: rest } : { state: 'waiting' }
    }
    // Everything streamed so far matches their typing — the stream is just behind
    if (typedSince.startsWith(cand)) waiting = true
  }

  return waiting ? { state: 'waiting' } : { state: 'diverged' }
}

export async function triggerPrediction(): Promise<void> {
  clearTimer()

  const words = wordCount(buffer)
  if (words < MIN_WORDS) {
    log(`skip — ${words}/${MIN_WORDS} words:`, JSON.stringify(buffer))
    return
  }

  // If a request is already in flight for a prefix of the current buffer, let it
  // finish — restarting now would just repeat the same never-completing cycle.
  if (streamController && predictedFrom !== null && buffer.startsWith(predictedFrom)) {
    log('in flight for a prefix — letting it finish')
    return
  }

  abortStream()

  const { clipboardContext, screenContext, engine, userFacts } = readSettings()
  const ctx: CompletionContext = {}

  if (screenContext) {
    ctx.windowTitle = getActiveWindowTitle()
    // Cached frame only — capturing costs ~780ms and would blow the latency
    // budget. refreshScreenFrame() below tops it up for the next prediction.
    ctx.screenB64 = getScreenFrame(lastWindowId) ?? undefined
    if (!ctx.screenB64) log('no cached screen frame yet — predicting without it')
    refreshScreenFrame(lastWindowId)
  }

  if (clipboardContext) {
    const clip = clipboard.readText()
    if (clip) ctx.clipboard = clip
  }

  const examples = recentExamples()
  if (examples.length) ctx.examples = examples

  // Prefer the real field contents over our keystroke buffer: it includes text
  // that was already there, pasted text, and everything above the cursor — none
  // of which the buffer can know about. Falls back to the buffer for apps that
  // expose no text pattern (canvases, games, some native controls).
  const field = getFocusedFieldText()
  if (field && field.before.endsWith(buffer.slice(-12)) && field.before.length > buffer.length) {
    ctx.textAfterCaret = field.after.slice(0, 400) || undefined
    log(`field text: ${field.before.length} chars before caret (buffer had ${buffer.length})`)
  }
  const promptText = field && field.before.length > buffer.length ? field.before : buffer

  // Reconciliation compares against what the USER typed, so predictedFrom must
  // stay the keystroke buffer even when the prompt used richer field text.
  const requestedFrom = buffer
  const t0 = Date.now()
  log('predict from:', JSON.stringify(promptText.slice(-60)))

  // ── Local first: ~30-76ms versus ~850ms for the cloud. Show something the
  // instant we can, then let the cloud improve on it. ──
  const useLocal = engine !== 'cloud' && isLocalReady()
  if (useLocal) {
    let firstAt = 0
    // Stream it onto the screen: the first token arrives in ~30ms even though the
    // full answer takes ~130ms. The local model also gets only the immediate tail —
    // prompt length is prefill time, and prefill is the latency budget.
    const localText = await completeLocal(
      promptText.slice(-160),
      userFacts ?? '',
      (soFar) => {
        if (!buffer.startsWith(requestedFrom)) return
        currentSuggestion = soFar
        predictedFrom = requestedFrom
        const r = reconcile(requestedFrom, currentSuggestion, buffer)
        if (r.state !== 'show') return
        if (!firstAt) {
          firstAt = Date.now() - t0
          log(`local first token in ${firstAt}ms`)
        }
        showSuggestion(r.text)
        if (!suggestionVisible) { suggestionVisible = true; registerTab() }
      }
    )

    if (localText && buffer.startsWith(requestedFrom)) {
      currentSuggestion = localText
      predictedFrom = requestedFrom
      const r = reconcile(requestedFrom, currentSuggestion, buffer)
      log(`local done in ${Date.now() - t0}ms: ${JSON.stringify(localText)} [${r.state}]`)
      if (r.state === 'show') {
        showSuggestion(r.text)
        if (!suggestionVisible) { suggestionVisible = true; registerTab() }
      }
    } else {
      log(`local done in ${Date.now() - t0}ms: discarded (empty or buffer moved on)`)
    }
  }

  if (engine === 'local') return

  const controller = new AbortController()
  streamController = controller
  predictedFrom = requestedFrom
  // The cloud result accumulates separately so a partially-streamed upgrade can
  // never replace a complete local suggestion with half a sentence.
  let cloudText = ''

  let firstToken = true

  streamCompletion(
    promptText,
    ctx,
    (token) => {
      if (controller.signal.aborted) return
      cloudText += token

      if (firstToken) {
        firstToken = false
        log(`cloud first token after ${Date.now() - t0}ms:`, JSON.stringify(token))
      }

      // With a local suggestion already on screen, don't stream over it — a
      // half-arrived cloud sentence is worse than a complete local one. Wait for
      // the full result and swap once, in onDone.
      if (useLocal && currentSuggestion) return

      currentSuggestion = cloudText

      // Re-evaluate on every token: the display may only become possible once
      // the stream overtakes what the user has typed.
      const r = reconcile(requestedFrom, currentSuggestion, buffer)
      if (r.state === 'diverged') {
        log('discarded — typing diverged from suggestion')
        clearSuggestion()
        controller.abort()
        streamController = null
        return
      }
      if (r.state === 'waiting') return

      // Replace the whole ghost text rather than appending — always correct,
      // regardless of how much the user typed in the meantime.
      showSuggestion(r.text)
      if (!suggestionVisible) {
        suggestionVisible = true
        registerTab()
      }
    },
    () => {
      streamController = null

      // Upgrade a local suggestion to the cloud's, but only if it's still wanted
      // and actually different — swapping identical text would just flicker.
      if (useLocal && cloudText && cloudText !== currentSuggestion) {
        if (!buffer.startsWith(requestedFrom)) {
          log(`cloud done in ${Date.now() - t0}ms: not applied, buffer moved on`)
          return
        }
        const previous = currentSuggestion
        currentSuggestion = cloudText
        const r = reconcile(requestedFrom, currentSuggestion, buffer)
        if (r.state === 'show') {
          showSuggestion(r.text)
          if (!suggestionVisible) { suggestionVisible = true; registerTab() }
          log(`upgraded after ${Date.now() - t0}ms: ${JSON.stringify(previous)} -> ${JSON.stringify(cloudText)}`)
        } else {
          // Cloud text doesn't fit what's been typed; keep what was showing
          currentSuggestion = previous
          log(`cloud done in ${Date.now() - t0}ms: kept local (${r.state})`)
        }
        return
      }

      log(`done in ${Date.now() - t0}ms:`, JSON.stringify(currentSuggestion) +
          (suggestionVisible ? ' [SHOWING]' : ' [not shown]'))
    },
    (err) => {
      log('STREAM ERROR:', err.message)
      streamController = null
      // A local suggestion is still perfectly good — don't clear it because the
      // network failed.
      if (!(useLocal && currentSuggestion)) clearSuggestion()
    },
    controller.signal
  )
}

export function acceptSuggestion(): void {
  if (!suggestionVisible || !currentSuggestion) return

  // Insert only what isn't on screen yet — the user may have typed part of the
  // suggestion themselves since it appeared. Same reconciliation as the display,
  // so what gets inserted is exactly what was shown as ghost text.
  let inject: string
  if (predictedFrom !== null) {
    const r = reconcile(predictedFrom, currentSuggestion, buffer)
    if (r.state !== 'show') { clearSuggestion(); return }
    inject = r.text
  } else {
    inject = currentSuggestion
  }
  if (!inject) { clearSuggestion(); return }

  // Add the word separator if the caret isn't already after whitespace
  if (!/\s$/.test(buffer) && !/^\s/.test(inject)) inject = ` ${inject}`

  // A Tab press is an explicit "yes, that's my voice" — the best training signal
  // we get, and free to collect.
  recordAccepted(buffer, inject)

  clearTimer()
  abortStream()
  clearSuggestion()

  // Inject via clipboard swap
  const prev = clipboard.readText()
  buffer += inject
  clipboard.writeText(inject)
  sendCtrlV()
  setTimeout(() => clipboard.writeText(prev), 300)
}

export function dismissSuggestion(): void {
  clearTimer()
  abortStream()
  clearSuggestion()
}

export function startKeystrokeTracker(): void {
  uIOhook.on('keydown', (event) => {
    const { keycode, shiftKey, ctrlKey, altKey, metaKey } = event

    // Reset buffer when user switches windows so we don't bleed context across apps
    const winId = getForegroundWindowId()
    if (winId !== lastWindowId) {
      if (lastWindowId !== '') resetBuffer('window-change')
      lastWindowId = winId
      // Chromium builds its accessibility tree lazily; ask once per app switch
      // so the caret is resolvable by the time a prediction is ready.
      nudgeAccessibility()
      // Start a capture now so a frame is ready by the 3rd word instead of the
      // first prediction going blind.
      if (readSettings().screenContext) refreshScreenFrame(winId)
    }

    // Drop stale context after an idle gap — it's a new sentence by now
    const now = Date.now()
    if (buffer && lastKeyAt && now - lastKeyAt > IDLE_RESET_MS) {
      resetBuffer('idle')
    }
    lastKeyAt = now

    // Ctrl/Alt combos — most are destructive to buffer context
    if (ctrlKey || altKey || metaKey) {
      if (ctrlKey && (keycode === UiohookKey.Z || keycode === UiohookKey.Y || keycode === UiohookKey.X)) {
        resetBuffer('ctrl+z/y/x')
      }
      if (ctrlKey && keycode === UiohookKey.V) {
        setTimeout(() => resetBuffer('paste'), 100)
      }
      return
    }

    switch (keycode) {
      case UiohookKey.Backspace:
        // Deleting invalidates any prediction — it was made from longer text
        buffer = buffer.slice(0, -1)
        abortStream()
        clearSuggestion()
        schedulePrediction()
        return

      case UiohookKey.Delete:
        resetBuffer('delete')
        return

      case UiohookKey.Enter:
        // In almost every field Enter submits (chat boxes, search, forms) and the
        // text is gone. Carrying it forward poisons the next prediction.
        resetBuffer('enter')
        return

      case UiohookKey.Escape:
        dismissSuggestion()
        return

      case UiohookKey.Tab:
        // When suggestion is visible, globalShortcut.register('Tab') handles acceptance.
        // When no suggestion, Tab goes through to the app as normal (we just don't update buffer).
        return

      case UiohookKey.ArrowLeft:
      case UiohookKey.ArrowRight:
      case UiohookKey.ArrowUp:
      case UiohookKey.ArrowDown:
      case UiohookKey.Home:
      case UiohookKey.End:
      case UiohookKey.PageUp:
      case UiohookKey.PageDown:
        resetBuffer('navigation')
        return
    }

    const char = keycodeToChar(keycode, shiftKey)
    if (char) {
      buffer += char
      // Trimming the buffer would break startsWith() reconciliation, so drop the
      // live prediction if we have to truncate.
      if (buffer.length > 800) {
        buffer = buffer.slice(-600)
        abortStream()
        clearSuggestion()
      }

      const { enabled, trigger } = readSettings()
      if (!enabled || trigger === 'manual') return

      // Only reconcile while something is actually live — a request in flight or
      // a suggestion on screen. Reconciling against a finished request is how the
      // deadlock above happened.
      const live = streamController !== null || suggestionVisible
      if (live && predictedFrom !== null) {
        const r = reconcile(predictedFrom, currentSuggestion, buffer)
        if (r.state === 'show') { showSuggestion(r.text); return }
        if (r.state === 'waiting') return
        clearSuggestion()
        abortStream()
      }

      // A completed word is the best moment to predict, and firing immediately
      // rather than after a debounce hides ~110ms of the round trip. Requests
      // aren't cancelled by later keystrokes, so starting early is free.
      if (char === ' ') {
        clearTimer()
        void triggerPrediction()
        return
      }

      schedulePrediction()
    }
  })

  uIOhook.start()
}

export function stopKeystrokeTracker(): void {
  uIOhook.stop()
  clearTimer()
  abortStream()
  unregisterTab()
}
