import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'node:path'
import { getCaretScreenPos } from './win32'

let win: BrowserWindow | null = null

export function createSuggestionWindow(): void {
  win = new BrowserWindow({
    width: 500,
    height: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/suggestion.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/suggestion.html'))
  }
}

function positionNearCaret(): void {
  if (!win || win.isDestroyed()) return
  const caret = getCaretScreenPos()
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.bounds

  let x: number
  let y: number

  if (caret) {
    // Below the caret line, offset right a touch
    x = Math.min(caret.x + 4, sw - 504)
    y = caret.y + caret.h + 4
    // Flip above if too close to bottom
    if (y + 52 > sh) y = caret.y - 52
  } else {
    // Fallback: bottom-center
    x = Math.round(sw / 2) - 250
    y = sh - 80
  }

  win.setBounds({ x: Math.max(0, x), y: Math.max(0, y), width: 500, height: 48 })
}

export function showSuggestion(text: string): void {
  if (!win || win.isDestroyed()) return
  positionNearCaret()
  win.webContents.send('suggestion:update', text)
  if (!win.isVisible()) win.show()
}

export function appendSuggestion(token: string): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('suggestion:append', token)
}

export function hideSuggestion(): void {
  if (!win || win.isDestroyed()) return
  win.hide()
  win.webContents.send('suggestion:update', '')
}

export function getSuggestionWindow(): BrowserWindow | null {
  return win
}

export function captureScreen(): Promise<string | null> {
  if (!win || win.isDestroyed()) return Promise.resolve(null)
  return new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('screen:capture-result', handler)
      resolve(null)
    }, 5000)

    function handler(_e: unknown, b64: string | null) {
      clearTimeout(timeout)
      resolve(b64)
    }

    ipcMain.once('screen:capture-result', handler)
    win!.webContents.send('screen:capture-request')
  })
}
