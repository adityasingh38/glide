/**
 * Does the ghost-text overlay actually appear on screen?
 *
 * Builds a window with the same config the app uses, loads the real
 * suggestion.html + preload, pushes text into it, then screenshots the desktop
 * so we can SEE whether it rendered — rather than trusting a [SHOWING] log line.
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/overlay-visual-test.cjs
 * Output: scripts/overlay-shot.jpg + scripts/overlay-test-result.txt
 */
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(__dirname, 'overlay-test-result.txt')
const SHOT = path.join(__dirname, 'overlay-shot.jpg')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay()
  say(`display ${display.bounds.width}x${display.bounds.height} scale=${display.scaleFactor}`)

  ipcMain.on('suggestion:rendered', (_e, info) => {
    say(`RENDERER REPORTED: chars=${info.chars} visible=${info.visible}`)
  })

  const win = new BrowserWindow({
    width: 500, height: 48,
    frame: false, transparent: true,
    alwaysOnTop: true, focusable: false, skipTaskbar: true,
    show: false, hasShadow: false,
    webPreferences: {
      preload: path.join(ROOT, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  win.webContents.on('did-finish-load', () => say('overlay html loaded'))
  win.webContents.on('preload-error', (_e, p, err) => say(`PRELOAD ERROR ${p}: ${err.message}`))

  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'suggestion.html'))

  // Put it somewhere unmistakable: middle of the screen
  const x = Math.round(display.bounds.width / 2) - 230
  const y = Math.round(display.bounds.height / 2)
  win.setBounds({ x, y, width: 460, height: 22 })
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')

  const b = win.getBounds()
  say(`overlay bounds ${b.x},${b.y} ${b.width}x${b.height} visible=${win.isVisible()}`)

  win.webContents.send('suggestion:update', 'GLIDE OVERLAY TEST — can you see this ghost text?')

  // Give it time to paint
  await new Promise(r => setTimeout(r, 1800))

  const title = await win.webContents.executeJavaScript('document.title')
  const ghostText = await win.webContents.executeJavaScript("document.getElementById('ghost').textContent")
  const ghostDisplay = await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('ghost')).display")
  const ghostColor = await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('ghost')).color")
  const bodyRect = await win.webContents.executeJavaScript("JSON.stringify(document.getElementById('ghost').getBoundingClientRect())")
  say(`document.title = ${JSON.stringify(title)}`)
  say(`ghost.textContent = ${JSON.stringify(ghostText)}`)
  say(`ghost display=${ghostDisplay} color=${ghostColor}`)
  say(`ghost rect = ${bodyRect}`)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.bounds.width, height: display.bounds.height }
  })
  const thumb = sources[0] && sources[0].thumbnail
  if (thumb && !thumb.isEmpty()) {
    // Crop tightly around where the overlay should be, so the text is legible
    const pad = 30
    const crop = thumb.crop({
      x: Math.max(0, x - pad),
      y: Math.max(0, y - pad),
      width: Math.min(460 + pad * 2, display.bounds.width - x + pad),
      height: 22 + pad * 2
    })
    fs.writeFileSync(SHOT, crop.toJPEG(92))
    say(`screenshot crop saved: ${SHOT} (${crop.getSize().width}x${crop.getSize().height})`)
  } else {
    say('screenshot FAILED')
  }

  say('DONE')
  app.exit(0)
})
