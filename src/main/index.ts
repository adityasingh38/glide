import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut, systemPreferences } from 'electron'
import { join } from 'node:path'
import { createSuggestionWindow } from './suggestion-window'
import { startKeystrokeTracker, stopKeystrokeTracker, acceptSuggestion, dismissSuggestion, triggerPrediction } from './keystroke-tracker'
import { readSettings, writeSettings } from './store'
import { testConnection } from './claude-client'
import { log, logPath } from './log'
import type { Settings } from './store'

// Pin the app name BEFORE anything touches app.getPath('userData').
// Running `electron out/main/index.js` unpackaged otherwise defaults the name to
// "Electron", so settings/logs land in %APPDATA%\Electron in dev but
// %APPDATA%\Glide once packaged — two different stores for the same app.
app.setName('Glide')

let tray: Tray | null = null
let settingsWin: BrowserWindow | null = null

function createSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 724,
    resizable: false,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWin.once('ready-to-show', () => settingsWin!.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    settingsWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    settingsWin.loadFile(join(__dirname, '../renderer/index.html'))
  }
  settingsWin.on('closed', () => { settingsWin = null })
}

function buildTrayMenu(): Menu {
  const { enabled } = readSettings()
  return Menu.buildFromTemplate([
    { label: enabled ? '● Active' : '○ Paused', enabled: false },
    { type: 'separator' },
    {
      label: enabled ? 'Pause' : 'Resume',
      click() {
        writeSettings({ enabled: !enabled })
        tray?.setContextMenu(buildTrayMenu())
      }
    },
    { label: 'Settings…', click: createSettingsWindow },
    { type: 'separator' },
    { label: 'Quit Glide', role: 'quit' }
  ])
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  app.dock?.hide()

  const s = readSettings()
  log('=== glide started ===')
  log('logging to', logPath())
  log('settings: enabled=' + s.enabled, 'trigger=' + s.trigger, 'model=' + s.model,
      'hasKey=' + Boolean(s.apiKey), 'maxTokens=' + s.maxTokens)

  createSuggestionWindow()
  try {
    startKeystrokeTracker()
    log('keystroke tracker started')
  } catch (e) {
    log('KEYSTROKE TRACKER FAILED:', e instanceof Error ? e.message : String(e))
  }

  globalShortcut.register('Ctrl+Shift+Space', () => {
    const { enabled } = readSettings()
    if (enabled) triggerPrediction()
  })

  // NOTE: Escape is deliberately NOT a globalShortcut — that would consume it
  // system-wide and break Esc in every app. The passive uiohook keydown handler
  // in keystroke-tracker dismisses on Escape without swallowing the key.

  const iconPath = join(__dirname, '../../build/tray.png')
  const rawIcon = nativeImage.createFromPath(iconPath)
  const icon = rawIcon.isEmpty() ? nativeImage.createEmpty() : rawIcon

  tray = new Tray(icon)
  tray.setToolTip('Glide')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => tray?.popUpContextMenu())

  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    writeSettings(patch)
    tray?.setContextMenu(buildTrayMenu())
  })
  ipcMain.handle('system:accentColor', () => {
    try {
      const hex = systemPreferences.getAccentColor() // 'rrggbbaa'
      return `#${hex.slice(0, 6)}`
    } catch {
      return '#0078d4' // Windows blue fallback
    }
  })
  ipcMain.on('window:close', () => settingsWin?.close())
  ipcMain.handle('api:test', () => testConnection())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopKeystrokeTracker()
})

app.on('window-all-closed', () => { /* tray-only app */ })
