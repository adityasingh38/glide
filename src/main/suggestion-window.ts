import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'node:path'
import { getCaretScreenPos } from './win32'
import { log } from './log'

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

  // Default alwaysOnTop sits at 'normal' level, which loses to other topmost
  // windows. 'screen-saver' floats above everything, including fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/suggestion.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/suggestion.html'))
  }

  win.webContents.on('did-finish-load', () => log('suggestion overlay loaded'))
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    log(`suggestion overlay FAILED to load: ${code} ${desc}`))
  win.webContents.on('preload-error', (_e, p, err) =>
    log(`suggestion overlay preload error at ${p}: ${err.message}`))

  // The renderer confirms it actually painted, so a silent bridge failure can't
  // masquerade as "the suggestion is showing".
  ipcMain.on('suggestion:rendered', (_e, info: { chars: number; visible: boolean }) => {
    log(`overlay painted: ${info.chars} chars visible=${info.visible}`)
  })
}

function positionNearCaret(): void {
  if (!win || win.isDestroyed()) return
  const W = 460
  const phys = getCaretScreenPos()

  let x: number
  let y: number
  let h: number
  let display: Electron.Display

  if (phys && phys.h > 0) {
    // UIA and GetGUIThreadInfo report PHYSICAL pixels, but setBounds takes DIPs.
    // On a 125% display (1920x1080 physical = 1536x864 DIP) feeding physical
    // coords straight in put y beyond the logical screen height, so the clamp
    // pinned the overlay to the bottom edge — behind the taskbar — every time.
    const pt = screen.screenToDipPoint({ x: phys.x, y: phys.y })
    display = screen.getDisplayNearestPoint(pt)
    const scale = display.scaleFactor || 1
    x = Math.round(pt.x)
    y = Math.round(pt.y)
    h = Math.max(Math.round(phys.h / scale), 18)
    log(`caret phys ${phys.x},${phys.y} h${phys.h} -> dip ${x},${y} h${h} (scale ${scale})`)
  } else {
    display = screen.getPrimaryDisplay()
    x = Math.round(display.workArea.x + display.workArea.width / 2 - W / 2)
    y = display.workArea.y + display.workArea.height - 44
    h = 22
    log('caret UNRESOLVED — bottom-center fallback')
  }

  // The ghost text must sit on the same baseline as the text being typed, so the
  // window has to straddle the caret rect exactly. Padding the height to a
  // minimum and centring inside it pushed the text off the caret's centre — keep
  // the box the caret's height and grow it symmetrically only if it's tiny.
  const H = Math.max(h, 18)
  const yCentred = Math.round(y + h / 2 - H / 2)

  // Clamp to workArea, not bounds: bounds includes the taskbar, which is exactly
  // where the mis-scaled coordinates were landing.
  const wa = display.workArea
  const bounds = {
    x: Math.max(wa.x, Math.min(x, wa.x + wa.width - W)),
    y: Math.max(wa.y, Math.min(yCentred, wa.y + wa.height - H)),
    width: W,
    height: H
  }
  win.setBounds(bounds)
}

export function showSuggestion(text: string): void {
  if (!win || win.isDestroyed()) return
  positionNearCaret()
  win.webContents.send('suggestion:update', text)
  if (!win.isVisible()) {
    // showInactive(), not show(): this window is focusable:false, and show()
    // tries to focus it — on Windows that can leave it unpainted, and would
    // steal focus from whatever the user is typing into.
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    const b = win.getBounds()
    log(`overlay shown at ${b.x},${b.y} ${b.width}x${b.height} visible=${win.isVisible()}`)
  }
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

// captureScreen() lived here and round-tripped through the preload's
// desktopCapturer, which is undefined in a renderer context on Electron 17+ —
// it always resolved null. Capture now happens in src/main/screen-context.ts.
