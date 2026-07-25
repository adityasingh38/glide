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
  const W = 460

  let x: number, y: number, h: number

  if (caret && caret.h > 0) {
    x = caret.x
    y = caret.y
    h = caret.h
  } else {
    // Fallback: bottom-center
    x = Math.round(sw / 2) - 230
    y = sh - 60
    h = 20
  }

  win.setBounds({
    x: Math.max(0, Math.min(x, sw - W)),
    y: Math.max(0, Math.min(y, sh - h)),
    width: W,
    height: h
  })
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
