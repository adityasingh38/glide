import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut, systemPreferences } from 'electron'
import { join } from 'node:path'
import { createSuggestionWindow } from './suggestion-window'
import { startKeystrokeTracker, stopKeystrokeTracker, acceptSuggestion, dismissSuggestion, triggerPrediction } from './keystroke-tracker'
import { readSettings, writeSettings } from './store'
import { testConnection } from './claude-client'
import type { Settings } from './store'

let tray: Tray | null = null
let settingsWin: BrowserWindow | null = null

function createSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 580,
    resizable: false,
    frame: false,
    show: false,
    transparent: true,
    // Opaque fallback for Windows 10 (Mica not available)
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Windows 11 Mica material — silently no-ops on Win10
  try { (settingsWin as any).setBackgroundMaterial('mica') } catch {}

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

  createSuggestionWindow()
  startKeystrokeTracker()

  globalShortcut.register('Ctrl+Shift+Space', () => {
    const { enabled } = readSettings()
    if (enabled) triggerPrediction()
  })

  globalShortcut.register('Escape', () => dismissSuggestion())

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
