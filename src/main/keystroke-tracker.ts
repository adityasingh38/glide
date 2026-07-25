import { uIOhook, UiohookKey } from 'uiohook-napi'
import { streamCompletion } from './claude-client'
import { showSuggestion, appendSuggestion, hideSuggestion } from './suggestion-window'
import { readSettings } from './store'
import { clipboard } from 'electron'
import { sendCtrlV } from './win32'

// Rolling text buffer — tracks what the user has typed since last reset
let buffer = ''
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let streamController: AbortController | null = null
let currentSuggestion = ''
let suggestionVisible = false

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
  cancelStream()
  hideSuggestion()
  suggestionVisible = false
  currentSuggestion = ''
}

function cancelStream(): void {
  if (streamController) {
    streamController.abort()
    streamController = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function schedulePrediction(): void {
  cancelStream()
  const { debounceMs, enabled, trigger } = readSettings()
  if (!enabled || trigger === 'manual') return
  if (buffer.trim().length < 6) return  // need at least a few chars

  debounceTimer = setTimeout(() => {
    triggerPrediction()
  }, debounceMs)
}

export function triggerPrediction(): void {
  cancelStream()
  if (buffer.trim().length < 3) return

  const controller = new AbortController()
  streamController = controller
  currentSuggestion = ''

  let firstToken = true

  streamCompletion(
    buffer,
    (token) => {
      currentSuggestion += token
      if (firstToken) {
        firstToken = false
        showSuggestion(token)
        suggestionVisible = true
      } else {
        appendSuggestion(token)
      }
    },
    () => { /* done */ },
    (err) => {
      console.error('[glide] stream error:', err.message)
      hideSuggestion()
      suggestionVisible = false
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

  // Inject via clipboard swap
  const prev = clipboard.readText()
  // Add a leading space if buffer doesn't end with whitespace
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
}

export function startKeystrokeTracker(): void {
  uIOhook.on('keydown', (event) => {
    const { keycode, shiftKey, ctrlKey, altKey, metaKey } = event

    // Ctrl/Alt combos — most are destructive to buffer context
    if (ctrlKey || altKey || metaKey) {
      // Ctrl+Z/Y (undo/redo), Ctrl+X (cut) invalidate our buffer
      if (ctrlKey && (keycode === UiohookKey.Z || keycode === UiohookKey.Y || keycode === UiohookKey.X)) {
        resetBuffer('ctrl+z/y/x')
      }
      // Ctrl+V — user pasted something; hard to track, so just reset
      if (ctrlKey && keycode === UiohookKey.V) {
        // Only reset if it's a real user paste (not our own injection).
        // We detect our own paste by checking the flag set in acceptSuggestion.
        // Simple approach: reset with a short delay so our SendInput Ctrl+V is ignored
        setTimeout(() => resetBuffer('paste'), 100)
      }
      return
    }

    // Dismiss on any key while suggestion is showing (before checking what the key is)
    if (suggestionVisible &&
        keycode !== UiohookKey.Escape &&
        keycode !== UiohookKey.Ctrl &&
        keycode !== UiohookKey.Shift) {
      cancelStream()
      hideSuggestion()
      suggestionVisible = false
      currentSuggestion = ''
      // Don't return — still want to add the char to buffer
    }

    switch (keycode) {
      case UiohookKey.Backspace:
        buffer = buffer.slice(0, -1)
        schedulePrediction()
        return

      case UiohookKey.Delete:
        // Delete mid-text — hard to track position, reset
        resetBuffer('delete')
        return

      case UiohookKey.Enter:
        buffer += '\n'
        schedulePrediction()
        return

      case UiohookKey.Escape:
        dismissSuggestion()
        return

      // Arrow keys / Home / End / PgUp/Dn mean cursor moved — buffer is stale
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

      // Tab — allow it to reach the app; just dismiss
      case UiohookKey.Tab:
        dismissSuggestion()
        return
    }

    const char = keycodeToChar(keycode, shiftKey)
    if (char) {
      buffer += char
      // Keep buffer from growing unbounded
      if (buffer.length > 800) buffer = buffer.slice(-600)
      schedulePrediction()
    }
  })

  uIOhook.start()
}

export function stopKeystrokeTracker(): void {
  uIOhook.stop()
  cancelStream()
}
