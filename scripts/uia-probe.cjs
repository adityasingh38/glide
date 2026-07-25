/**
 * UIA caret probe — polls the focused element and reports whether a caret rect
 * is obtainable. GetGUIThreadInfo only reports a caret for native Win32 edit
 * controls; Chromium/Electron draw their own caret and expose it only via UIA.
 *
 * Run:  node scripts/uia-probe.cjs
 * Then click into text fields in different apps and watch the output.
 */
const koffi = require('koffi')

const ole32    = koffi.load('ole32.dll')
const oleaut32 = koffi.load('oleaut32.dll')
const user32   = koffi.load('user32.dll')

// Chromium keeps its accessibility tree off until it believes an assistive-tech
// client is present. WM_GETOBJECT is the signal screen readers trip; sending it
// is what makes Chrome/Electron expose TextPattern at all.
const RECT = koffi.struct('RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' })
const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
  cbSize: 'uint', flags: 'uint',
  hwndActive: 'void *', hwndFocus: 'void *', hwndCapture: 'void *',
  hwndMenuOwner: 'void *', hwndMoveSize: 'void *', hwndCaret: 'void *',
  rcCaret: RECT
})

const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const GetGUIThreadInfo = user32.func('int GetGUIThreadInfo(uint idThread, _Inout_ GUITHREADINFO *pgui)')
const SendMessageTimeoutW = user32.func(
  'long SendMessageTimeoutW(void *hwnd, uint msg, size_t wParam, size_t lParam, uint flags, uint timeout, _Out_ size_t *result)'
)
const GetClassNameW = user32.func('int GetClassNameW(void *hwnd, _Out_ void *buf, int max)')

const WM_GETOBJECT = 0x003D
const OBJID_CLIENT = 0xFFFFFFFC
const SMTO_ABORTIFHUNG = 0x0002

function emptyGti() {
  const g = {
    cbSize: 0, flags: 0,
    hwndActive: null, hwndFocus: null, hwndCapture: null,
    hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null,
    rcCaret: { left: 0, top: 0, right: 0, bottom: 0 }
  }
  g.cbSize = koffi.sizeof(GUITHREADINFO)
  return g
}

function className(hwnd) {
  try {
    const buf = Buffer.alloc(512)
    const n = GetClassNameW(hwnd, buf, 255)
    return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
  } catch { return '' }
}

/**
 * The renderer's accessibility tree lives behind a CHILD hwnd
 * (Chrome_RenderWidgetHostHWND), so nudging the top-level window does nothing.
 * Target the focused child from GetGUIThreadInfo, plus the top-level as backup.
 */
function nudgeAccessibility() {
  const res = [0]
  try {
    const g = emptyGti()
    if (GetGUIThreadInfo(0, g) && g.hwndFocus) {
      SendMessageTimeoutW(g.hwndFocus, WM_GETOBJECT, 0, OBJID_CLIENT, SMTO_ABORTIFHUNG, 60, res)
    }
  } catch {}
  try {
    const h = GetForegroundWindow()
    if (h) SendMessageTimeoutW(h, WM_GETOBJECT, 0, OBJID_CLIENT, SMTO_ABORTIFHUNG, 60, res)
  } catch {}
}

function focusInfo() {
  try {
    const g = emptyGti()
    if (!GetGUIThreadInfo(0, g)) return ''
    return `focusCls=${className(g.hwndFocus) || '-'} gtiCaret=${g.hwndCaret ? 'yes' : 'no'}`
  } catch { return '' }
}

const CoInitializeEx = ole32.func('long CoInitializeEx(void *reserved, uint32 coInit)')
const CoCreateInstance = ole32.func(
  'long CoCreateInstance(const void *rclsid, void *pUnkOuter, uint32 ctx, const void *riid, _Out_ void **ppv)'
)
const SafeArrayGetLBound    = oleaut32.func('long SafeArrayGetLBound(void *psa, uint32 dim, _Out_ long *lb)')
const SafeArrayGetUBound    = oleaut32.func('long SafeArrayGetUBound(void *psa, uint32 dim, _Out_ long *ub)')
const SafeArrayAccessData   = oleaut32.func('long SafeArrayAccessData(void *psa, _Out_ void **ppv)')
const SafeArrayUnaccessData = oleaut32.func('long SafeArrayUnaccessData(void *psa)')
const SafeArrayDestroy      = oleaut32.func('long SafeArrayDestroy(void *psa)')

function guid(str) {
  const h = str.replace(/[{}-]/g, '')
  const b = Buffer.alloc(16)
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0)
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4)
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6)
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)
  return b
}

const CLSID_CUIAutomation = guid('{FF48DBA4-60EF-4201-AA87-54103EEF594E}')
const IID_IUIAutomation   = guid('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}')

const PTR = 8
function vcall(iface, idx, proto, ...args) {
  const vtbl = koffi.decode(iface, 'void *')
  const fn = koffi.decode(vtbl, idx * PTR, 'void *')
  return koffi.call(fn, proto, iface, ...args)
}

const P_Release  = koffi.proto('long Release(void *self)')
const P_GetFocusedElement = koffi.proto('long GetFocusedElement(void *self, _Out_ void **el)')
const P_GetCurrentPattern = koffi.proto('long GetCurrentPattern(void *self, int patternId, _Out_ void **pat)')
const P_GetCtrlType = koffi.proto('long get_CurrentControlType(void *self, _Out_ int *ct)')
const P_GetSelection = koffi.proto('long GetSelection(void *self, _Out_ void **ranges)')
const P_GetLength  = koffi.proto('long get_Length(void *self, _Out_ int *len)')
const P_GetElement = koffi.proto('long GetElement(void *self, int index, _Out_ void **range)')
const P_Clone      = koffi.proto('long Clone(void *self, _Out_ void **range)')
const P_MoveEndpointByUnit = koffi.proto('long MoveEndpointByUnit(void *self, int ep, int unit, int count, _Out_ int *moved)')
const P_GetBoundingRectangles = koffi.proto('long GetBoundingRectangles(void *self, _Out_ void **sa)')

const V_Release = 2
const V_GetFocusedElement = 8
const V_El_GetCurrentPattern = 16
const V_El_get_CurrentControlType = 21
const V_Text_GetSelection = 5
const V_Arr_get_Length = 3
const V_Arr_GetElement = 4
const V_Rng_Clone = 3
const V_Rng_GetBoundingRectangles = 10
const V_Rng_MoveEndpointByUnit = 14

const PATTERNS = { Text: 10014, TextPattern2: 10024, TextEdit: 10032, Value: 10002 }
const CTRL = {
  50004: 'Edit', 50030: 'Document', 50032: 'Custom', 50033: 'Group',
  50000: 'Button', 50020: 'Text', 50026: 'Pane', 50011: 'Window',
}

function release(p) { if (p) try { vcall(p, V_Release, P_Release) } catch {} }

function readRects(sa) {
  const lb = [0], ub = [0]
  if (SafeArrayGetLBound(sa, 1, lb) !== 0) return []
  if (SafeArrayGetUBound(sa, 1, ub) !== 0) return []
  const n = ub[0] - lb[0] + 1
  if (n <= 0) return []
  const pd = [null]
  if (SafeArrayAccessData(sa, pd) !== 0) return []
  // koffi.view() hands back an ArrayBuffer sharing the native memory
  const dv = new DataView(koffi.view(pd[0], n * 8))
  const nums = []
  for (let i = 0; i < n; i++) nums.push(dv.getFloat64(i * 8, true))
  SafeArrayUnaccessData(sa)
  const rects = []
  for (let i = 0; i + 3 < nums.length; i += 4)
    rects.push({ x: nums[i], y: nums[i+1], w: nums[i+2], h: nums[i+3] })
  return rects
}

function rectsFromRange(range) {
  const sa = [null]
  vcall(range, V_Rng_GetBoundingRectangles, P_GetBoundingRectangles, sa)
  let r = sa[0] ? readRects(sa[0]) : []
  if (sa[0]) SafeArrayDestroy(sa[0])
  if (r.length) return r
  // Collapsed caret: widen a clone one char backwards so it has geometry
  const c = [null]
  vcall(range, V_Rng_Clone, P_Clone, c)
  if (!c[0]) return []
  const moved = [0]
  vcall(c[0], V_Rng_MoveEndpointByUnit, P_MoveEndpointByUnit, 0 /*Start*/, 0 /*Char*/, -1, moved)
  const sa2 = [null]
  vcall(c[0], V_Rng_GetBoundingRectangles, P_GetBoundingRectangles, sa2)
  r = sa2[0] ? readRects(sa2[0]) : []
  if (sa2[0]) SafeArrayDestroy(sa2[0])
  release(c[0])
  return r
}

CoInitializeEx(null, 2)
const out = [null]
if (CoCreateInstance(CLSID_CUIAutomation, null, 1, IID_IUIAutomation, out) !== 0 || !out[0]) {
  console.log('FATAL: cannot create IUIAutomation'); process.exit(1)
}
const uia = out[0]
console.log('UIA ready — click into text fields in different apps. Ctrl+C to stop.\n')

let last = ''
setInterval(() => {
  nudgeAccessibility()
  const elO = [null]
  if (vcall(uia, V_GetFocusedElement, P_GetFocusedElement, elO) !== 0 || !elO[0]) return
  const el = elO[0]

  const ct = [0]
  try { vcall(el, V_El_get_CurrentControlType, P_GetCtrlType, ct) } catch {}
  const ctName = CTRL[ct[0]] || String(ct[0])

  const found = []
  let caret = null
  for (const [name, id] of Object.entries(PATTERNS)) {
    const p = [null]
    try { vcall(el, V_El_GetCurrentPattern, P_GetCurrentPattern, id, p) } catch { continue }
    if (!p[0]) continue
    found.push(name)
    if ((name === 'Text' || name === 'TextEdit') && !caret) {
      const rg = [null]
      try { vcall(p[0], V_Text_GetSelection, P_GetSelection, rg) } catch {}
      if (rg[0]) {
        const len = [0]
        vcall(rg[0], V_Arr_get_Length, P_GetLength, len)
        if (len[0] > 0) {
          const r0 = [null]
          vcall(rg[0], V_Arr_GetElement, P_GetElement, 0, r0)
          if (r0[0]) {
            const rects = rectsFromRange(r0[0])
            if (rects.length) {
              const l = rects[rects.length - 1]
              caret = { x: Math.round(l.x + l.w), y: Math.round(l.y), h: Math.round(l.h) }
            }
            release(r0[0])
          }
        }
        release(rg[0])
      }
    }
    release(p[0])
  }
  release(el)

  const line = `ctrl=${ctName} patterns=[${found.join(',')}] caret=${caret ? `x${caret.x} y${caret.y} h${caret.h}` : 'NONE'} ${focusInfo()}`
  if (line !== last) { console.log(line); last = line }
}, 600)
