/**
 * Can we read the FULL contents of the focused text field (not just keystrokes)?
 *
 * This is the difference between predicting from "my name is" and predicting with
 * the whole draft plus everything above the cursor. Uses the built main bundle's
 * UIA code path via a direct require of the compiled module is not possible
 * (it's bundled), so this reimplements the same calls to prove the vtable
 * indices and BSTR handling are right.
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/field-text-probe.cjs
 * Then click into text fields; it polls and prints what it can see.
 */
const { app } = require('electron')
const koffi = require('koffi')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'field-text-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

const ole32 = koffi.load('ole32.dll')
const oleaut32 = koffi.load('oleaut32.dll')
const user32 = koffi.load('user32.dll')

const CoInitializeEx = ole32.func('long CoInitializeEx(void *r, uint32 c)')
const CoCreateInstance = ole32.func('long CoCreateInstance(const void *rclsid, void *pUnkOuter, uint32 ctx, const void *riid, _Out_ void **ppv)')
const SysFreeString = oleaut32.func('void SysFreeString(void *bstr)')
const SysStringLen = oleaut32.func('uint32 SysStringLen(void *bstr)')

const RECT = koffi.struct('P_RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' })
const GTI = koffi.struct('P_GTI', {
  cbSize: 'uint', flags: 'uint',
  hwndActive: 'void *', hwndFocus: 'void *', hwndCapture: 'void *',
  hwndMenuOwner: 'void *', hwndMoveSize: 'void *', hwndCaret: 'void *', rcCaret: RECT
})
const GetGUIThreadInfo = user32.func('int GetGUIThreadInfo(uint idThread, _Inout_ P_GTI *pgui)')
const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const SendMessageTimeoutW = user32.func('long SendMessageTimeoutW(void *h, uint m, size_t w, size_t l, uint f, uint t, _Out_ size_t *r)')

function guid(str) {
  const h = str.replace(/[{}-]/g, '')
  const b = Buffer.alloc(16)
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0)
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4)
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6)
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)
  return b
}

const PTR = 8
function vcall(iface, idx, proto, ...args) {
  const vtbl = koffi.decode(iface, 'void *')
  const fn = koffi.decode(vtbl, idx * PTR, 'void *')
  return koffi.call(fn, proto, iface, ...args)
}

const P_Release = koffi.proto('long Release(void *self)')
const P_GetFocusedElement = koffi.proto('long GetFocusedElement(void *self, _Out_ void **el)')
const P_GetCurrentPattern = koffi.proto('long GetCurrentPattern(void *self, int id, _Out_ void **p)')
const P_GetSelection = koffi.proto('long GetSelection(void *self, _Out_ void **r)')
const P_get_Length = koffi.proto('long get_Length(void *self, _Out_ int *l)')
const P_GetElement = koffi.proto('long GetElement(void *self, int i, _Out_ void **r)')
const P_Clone = koffi.proto('long Clone(void *self, _Out_ void **r)')
const P_get_DocumentRange = koffi.proto('long get_DocumentRange(void *self, _Out_ void **r)')
const P_GetText = koffi.proto('long GetText(void *self, int max, _Out_ void **t)')
const P_MoveEndpointByRange = koffi.proto('long MoveEndpointByRange(void *self, int ep, void *target, int targetEp)')

const V = {
  Release: 2, GetFocusedElement: 8, GetCurrentPattern: 16,
  GetSelection: 5, DocumentRange: 7,
  ArrLen: 3, ArrGet: 4,
  Clone: 3, GetText: 12, MoveEndpointByRange: 15
}
const TEXT_PATTERN = 10014
const TEXT_EDIT_PATTERN = 10032

function release(p) { if (p) { try { vcall(p, V.Release, P_Release) } catch {} } }

// koffi.decode(ptr,'str16') is FATAL under Electron (aborts the process).
// Read UTF-16 units individually using the BSTR length prefix instead.
function takeBstr(out) {
  const p = out[0]
  if (!p) return ''
  try {
    const len = Math.min(Number(SysStringLen(p)) || 0, 8192)
    if (len <= 0) return ''
    const units = new Array(len)
    for (let i = 0; i < len; i++) units[i] = koffi.decode(p, i * 2, 'uint16')
    let s = ''
    for (let i = 0; i < units.length; i += 4096) s += String.fromCharCode(...units.slice(i, i + 4096))
    return s
  } catch (e) { return '<decode failed: ' + e.message + '>' }
  finally { try { SysFreeString(p) } catch {} }
}

function nudge() {
  const res = [0]
  try {
    const g = { cbSize: koffi.sizeof(GTI), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null, rcCaret: { left: 0, top: 0, right: 0, bottom: 0 } }
    if (GetGUIThreadInfo(0, g) && g.hwndFocus) SendMessageTimeoutW(g.hwndFocus, 0x3d, 0, 0xfffffffc, 2, 40, res)
  } catch {}
  try { const h = GetForegroundWindow(); if (h) SendMessageTimeoutW(h, 0x3d, 0, 0xfffffffc, 2, 40, res) } catch {}
}

CoInitializeEx(null, 2)
const out = [null]
if (CoCreateInstance(guid('{FF48DBA4-60EF-4201-AA87-54103EEF594E}'), null, 1, guid('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}'), out) !== 0) {
  say('cannot create IUIAutomation'); process.exit(1)
}
const uia = out[0]

app.whenReady().then(() => {
  say('polling focused field text — click into text boxes and type. Ctrl+C to stop.')
  let last = ''

  setInterval(() => {
    nudge()
    let el = null, pat = null, doc = null, ranges = null, sel = null, before = null, after = null
    let step = 'start'
    function bail(why) { if (why !== last) { say('STOP at ' + why); last = why } }
    try {
      const e = [null]
      const hrEl = vcall(uia, V.GetFocusedElement, P_GetFocusedElement, e)
      if (hrEl !== 0 || !e[0]) return bail(`GetFocusedElement hr=0x${(hrEl >>> 0).toString(16)} el=${!!e[0]}`)
      el = e[0]

      let which = ''
      for (const id of [TEXT_PATTERN, TEXT_EDIT_PATTERN]) {
        const p = [null]
        if (vcall(el, V.GetCurrentPattern, P_GetCurrentPattern, id, p) !== 0) continue
        if (p[0]) { pat = p[0]; which = String(id); break }
      }
      if (!pat) return bail('no TextPattern on focused element')

      const d = [null]
      const hrDoc = vcall(pat, V.DocumentRange, P_get_DocumentRange, d)
      if (hrDoc !== 0 || !d[0]) return bail(`get_DocumentRange hr=0x${(hrDoc >>> 0).toString(16)} range=${!!d[0]} (pattern ${which})`)
      doc = d[0]

      // Whole document first — simplest possible GetText call
      const dt = [null]
      const hrDt = vcall(doc, V.GetText, P_GetText, -1, dt)
      const docText = takeBstr(dt)
      if (hrDt !== 0) return bail(`doc GetText hr=0x${(hrDt >>> 0).toString(16)}`)

      const r = [null]
      const hrSel = vcall(pat, V.GetSelection, P_GetSelection, r)
      if (hrSel !== 0 || !r[0]) return bail(`GetSelection hr=0x${(hrSel >>> 0).toString(16)}`)
      ranges = r[0]
      const len = [0]
      vcall(ranges, V.ArrLen, P_get_Length, len)
      if (len[0] < 1) return bail('selection array empty')
      const s = [null]
      vcall(ranges, V.ArrGet, P_GetElement, 0, s)
      if (!s[0]) return bail('selection GetElement null')
      sel = s[0]

      const b = [null]
      vcall(doc, V.Clone, P_Clone, b)
      if (!b[0]) return bail('Clone null')
      before = b[0]
      const hrMv = vcall(before, V.MoveEndpointByRange, P_MoveEndpointByRange, 1, sel, 0)
      const bt = [null]
      const hrBt = vcall(before, V.GetText, P_GetText, -1, bt)
      const beforeText = takeBstr(bt)
      step = `move hr=0x${(hrMv >>> 0).toString(16)} getText hr=0x${(hrBt >>> 0).toString(16)} docLen=${docText.length}`

      const a = [null]
      vcall(doc, V.Clone, P_Clone, a)
      let afterText = ''
      if (a[0]) {
        after = a[0]
        vcall(after, V.MoveEndpointByRange, P_MoveEndpointByRange, 0, sel, 1)
        const at = [null]
        vcall(after, V.GetText, P_GetText, -1, at)
        afterText = takeBstr(at)
      }

      const line = `${step} | before(${beforeText.length})=${JSON.stringify(beforeText.slice(-70))} | after(${afterText.length})=${JSON.stringify(afterText.slice(0, 40))}`
      if (line !== last) { say(line); last = line }
    } catch (err) {
      const l = 'ERR ' + err.message
      if (l !== last) { say(l); last = l }
    } finally {
      release(after); release(before); release(sel); release(ranges); release(doc); release(pat); release(el)
    }
  }, 700)
})
