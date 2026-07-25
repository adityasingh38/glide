import { uIOhook, UiohookKey } from 'uiohook-napi'
import { globalShortcut, clipboard } from 'electron'
import { streamCompletion, type CompletionContext } from './claude-client'
import { showSuggestion, appendSuggestion, hideSuggestion, captureScreen } from './suggestion-window'
import { readSettings } from './store'
import { sendCtrlV, getActiveWindowTitle, getForegroundHwnd } from './win32'

let buffer = ''
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let streamController: AbortController | null = null
let currentSuggestion = ''
let suggestionVisible = false
let tabRegistered = false
let lastHwnd: unknown = null

// Minimum pause before firing a prediction — lets the API return before next cancel
const DEBOUNCE_MS = 280

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

// Map UiohookKey codes to printable chars (shift-aware for common keys)
function keycodeToChar(keycode: number, shift: boolean): string {
  // Letters
  if (keycode >= UiohookKey.A && keycode <= UiohookKey.Z) {
    const base = String.fromCharCode(keycode - UiohookKey.A + 97)
    return shift ? base.toUpperCase() : base
  }

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
  if (reason) console.log('[glide] buffer reset:', reason)
  buffer = ''
  lastHwnd = null
  cancelStream()
  hideSuggestion()
  suggestionVisible = false
  currentSuggestion = ''
  unregisterTab()
}

function cancelStream(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (streamController) { streamController.abort(); streamController = null }
}

export async function triggerPrediction(): Promise<void> {
  cancelStream()
  if (buffer.trim().length < 2) return

  const { clipboardContext, screenContext } = readSettings()
  const ctx: CompletionContext = {}

  if (screenContext) {
    ctx.windowTitle = getActiveWindowTitle()
    ctx.screenB64 = (await captureScreen()) ?? undefined
  }

  if (clipboardContext) {
    const clip = clipboard.readText()
    if (clip) ctx.clipboard = clip
  }

  const controller = new AbortController()
  streamController = controller
  currentSuggestion = ''

  let firstToken = true

  streamCompletion(
    buffer,
    ctx,
    (token) => {
      currentSuggestion += token
      if (firstToken) {
        firstToken = false
        showSuggestion(token)
        suggestionVisible = true
        registerTab()
      } else {
        appendSuggestion(token)
      }
    },
    () => { /* done */ },
    (err) => {
      console.error('[glide] stream error:', err.message)
      hideSuggestion()
      suggestionVisible = false
      unregisterTab()
    },
    controller.signal
  )
}

export function acceptSuggestion(): void {
  if (!suggestionVisible || !currentSuggestion) return
  const text = currentSuggestion
  hideSuggestion()
  suggestionVisible = false
  currentSuggestion = ''
  cancelStream()
  unregisterTab()

  // Inject via clipboard swap
  const prev = clipboard.readText()
  const inject = /\s$/.test(buffer) ? text : ` ${text}`
  buffer += inject
  clipboard.writeText(inject)
  sendCtrlV()
  setTimeout(() => clipboard.writeText(prev), 300)
}

export function dismissSuggestion(): void {
  cancelStream()
  hideSuggestion()
  suggestionVisible = false
  currentSuggestion = ''
  unregisterTab()
}

export function startKeystrokeTracker(): void {
  uIOhook.on('keydown', (event) => {
    const { keycode, shiftKey, ctrlKey, altKey, metaKey } = event

    // Reset buffer when user switches windows so we don't bleed context across apps
    const hwnd = getForegroundHwnd()
    if (hwnd !== lastHwnd) {
      if (lastHwnd !== null) resetBuffer('window-change')
      lastHwnd = hwnd
    }

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

    // Dismiss on any key while suggestion is showing
    // Tab is excluded — globalShortcut handles acceptance
    if (suggestionVisible &&
        keycode !== UiohookKey.Escape &&
        keycode !== UiohookKey.Ctrl &&
        keycode !== UiohookKey.Shift &&
        keycode !== UiohookKey.Tab) {
      cancelStream()
      hideSuggestion()
      suggestionVisible = false
      currentSuggestion = ''
      unregisterTab()
      // Don't return — still want to add the char to buffer
    }

    switch (keycode) {
      case UiohookKey.Backspace:
        buffer = buffer.slice(0, -1)
        cancelStream()
        debounceTimer = setTimeout(() => triggerPrediction(), DEBOUNCE_MS)
        return

      case UiohookKey.Delete:
        resetBuffer('delete')
        return

      case UiohookKey.Enter:
        buffer += '\n'
        cancelStream()
        debounceTimer = setTimeout(() => triggerPrediction(), DEBOUNCE_MS)
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
      if (buffer.length > 800) buffer = buffer.slice(-600)
      const { enabled, trigger } = readSettings()
      if (enabled && trigger !== 'manual') {
        cancelStream()
        debounceTimer = setTimeout(() => triggerPrediction(), DEBOUNCE_MS)
      }
    }
  })

  uIOhook.start()
}

export function stopKeystrokeTracker(): void {
  uIOhook.stop()
  cancelStream()
  unregisterTab()
}
