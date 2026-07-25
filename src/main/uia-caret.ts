/**
 * Caret position via UI Automation.
 *
 * `GetGUIThreadInfo` only reports a caret rect for native Win32 edit controls.
 * Chromium/Electron (Chrome, VS Code, Claude Code, Discord, Slack…) draw their
 * own caret and expose it only through UIA's TextPattern, so this is the path
 * that makes inline ghost text possible in those apps.
 *
 * Two things make it work, both verified against live Chrome:
 *  1. COM vtable calls through koffi (`koffi.call` on a decoded vtable slot).
 *  2. A WM_GETOBJECT nudge to the *focused child* hwnd — Chromium keeps its
 *     accessibility tree off until it thinks assistive tech is listening, and
 *     the renderer sits behind a child window, so nudging the top-level
 *     window alone does nothing.
 */
import koffi from 'koffi'

const ole32 = koffi.load('ole32.dll')
const oleaut32 = koffi.load('oleaut32.dll')
const user32 = koffi.load('user32.dll')

// ── COM / SAFEARRAY ────────────────────────────────────────────────────────

const CoInitializeEx = ole32.func('long CoInitializeEx(void *reserved, uint32 coInit)')
const CoCreateInstance = ole32.func(
  'long CoCreateInstance(const void *rclsid, void *pUnkOuter, uint32 ctx, const void *riid, _Out_ void **ppv)'
)
const SysFreeString = oleaut32.func('void SysFreeString(void *bstr)')
const SysStringLen = oleaut32.func('uint32 SysStringLen(void *bstr)')
const SafeArrayGetLBound = oleaut32.func('long SafeArrayGetLBound(void *psa, uint32 dim, _Out_ long *lb)')
const SafeArrayGetUBound = oleaut32.func('long SafeArrayGetUBound(void *psa, uint32 dim, _Out_ long *ub)')
const SafeArrayAccessData = oleaut32.func('long SafeArrayAccessData(void *psa, _Out_ void **ppv)')
const SafeArrayUnaccessData = oleaut32.func('long SafeArrayUnaccessData(void *psa)')
const SafeArrayDestroy = oleaut32.func('long SafeArrayDestroy(void *psa)')

// ── Accessibility nudge ────────────────────────────────────────────────────

const RECT = koffi.struct('GTI_RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' })
const GUITHREADINFO = koffi.struct('UIA_GUITHREADINFO', {
  cbSize: 'uint', flags: 'uint',
  hwndActive: 'void *', hwndFocus: 'void *', hwndCapture: 'void *',
  hwndMenuOwner: 'void *', hwndMoveSize: 'void *', hwndCaret: 'void *',
  rcCaret: RECT
})

const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const GetGUIThreadInfo = user32.func('int GetGUIThreadInfo(uint idThread, _Inout_ UIA_GUITHREADINFO *pgui)')
const SendMessageTimeoutW = user32.func(
  'long SendMessageTimeoutW(void *hwnd, uint msg, size_t wParam, size_t lParam, uint flags, uint timeout, _Out_ size_t *result)'
)

const WM_GETOBJECT = 0x003d
const OBJID_CLIENT = 0xfffffffc
const SMTO_ABORTIFHUNG = 0x0002

function guid(str: string): Buffer {
  const h = str.replace(/[{}-]/g, '')
  const b = Buffer.alloc(16)
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0)
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4)
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6)
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)
  return b
}

const CLSID_CUIAutomation = guid('{FF48DBA4-60EF-4201-AA87-54103EEF594E}')
const IID_IUIAutomation = guid('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}')

// ── vtable dispatch ────────────────────────────────────────────────────────
// A COM interface pointer points at its vtable; the vtable is an array of
// function pointers. koffi hands us no COM support, so read the slot and call it.

const PTR = 8 // x64 only — Electron ships x64/arm64, both 8-byte pointers

// koffi's IKoffiCType isn't exported in a usable form here; the prototypes are
// opaque handles as far as TS is concerned.
type Proto = Parameters<typeof koffi.call>[1]

function vcall(iface: unknown, slot: number, proto: Proto, ...args: unknown[]): number {
  const vtbl = koffi.decode(iface, 'void *')
  const fn = koffi.decode(vtbl, slot * PTR, 'void *')
  return koffi.call(fn, proto, iface, ...args) as number
}

const P_Release = koffi.proto('long Release(void *self)')
const P_GetFocusedElement = koffi.proto('long GetFocusedElement(void *self, _Out_ void **el)')
const P_GetCurrentPattern = koffi.proto('long GetCurrentPattern(void *self, int patternId, _Out_ void **pat)')
const P_GetSelection = koffi.proto('long GetSelection(void *self, _Out_ void **ranges)')
const P_get_Length = koffi.proto('long get_Length(void *self, _Out_ int *len)')
const P_GetElement = koffi.proto('long GetElement(void *self, int index, _Out_ void **range)')
const P_Clone = koffi.proto('long Clone(void *self, _Out_ void **range)')
const P_MoveEndpointByUnit = koffi.proto('long MoveEndpointByUnit(void *self, int ep, int unit, int count, _Out_ int *moved)')
const P_GetBoundingRectangles = koffi.proto('long GetBoundingRectangles(void *self, _Out_ void **sa)')
const P_get_DocumentRange = koffi.proto('long get_DocumentRange(void *self, _Out_ void **range)')
const P_GetText = koffi.proto('long GetText(void *self, int maxLength, _Out_ void **text)')
const P_MoveEndpointByRange = koffi.proto('long MoveEndpointByRange(void *self, int ep, void *targetRange, int targetEp)')

const V_Release = 2
const V_GetFocusedElement = 8
const V_El_GetCurrentPattern = 16
const V_Text_GetSelection = 5
const V_Arr_get_Length = 3
const V_Arr_GetElement = 4
const V_Rng_Clone = 3
const V_Rng_GetBoundingRectangles = 10
const V_Rng_MoveEndpointByUnit = 14
const V_Text_get_DocumentRange = 7
const V_Rng_GetText = 12
const V_Rng_MoveEndpointByRange = 15

const UIA_TextPatternId = 10014
const UIA_TextEditPatternId = 10032
const Endpoint_Start = 0
const TextUnit_Character = 0

function release(p: unknown): void {
  if (p) { try { vcall(p, V_Release, P_Release) } catch { /* ignore */ } }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let uia: unknown = null
let initFailed = false

function getAutomation(): unknown {
  if (uia) return uia
  if (initFailed) return null
  try {
    CoInitializeEx(null, 2 /* COINIT_APARTMENTTHREADED */)
    const out = [null]
    const hr = CoCreateInstance(CLSID_CUIAutomation, null, 1 /* CLSCTX_INPROC_SERVER */, IID_IUIAutomation, out)
    if (hr !== 0 || !out[0]) { initFailed = true; return null }
    uia = out[0]
    return uia
  } catch {
    initFailed = true
    return null
  }
}

function emptyGti(): Record<string, unknown> {
  const g: Record<string, unknown> = {
    cbSize: 0, flags: 0,
    hwndActive: null, hwndFocus: null, hwndCapture: null,
    hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null,
    rcCaret: { left: 0, top: 0, right: 0, bottom: 0 }
  }
  g.cbSize = koffi.sizeof(GUITHREADINFO)
  return g
}

/**
 * Ask the focused window for an accessibility object. Chromium interprets this
 * as "assistive tech is present" and builds its tree; without it the whole
 * render widget is exposed as a single pattern-less node.
 */
export function nudgeAccessibility(): void {
  const res = [0]
  try {
    const g = emptyGti()
    if (GetGUIThreadInfo(0, g) && g.hwndFocus) {
      SendMessageTimeoutW(g.hwndFocus, WM_GETOBJECT, 0, OBJID_CLIENT, SMTO_ABORTIFHUNG, 40, res)
    }
  } catch { /* ignore */ }
  try {
    const h = GetForegroundWindow()
    if (h) SendMessageTimeoutW(h, WM_GETOBJECT, 0, OBJID_CLIENT, SMTO_ABORTIFHUNG, 40, res)
  } catch { /* ignore */ }
}

// ── Rect extraction ────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

function readRects(sa: unknown): Rect[] {
  const lb = [0]
  const ub = [0]
  if (SafeArrayGetLBound(sa, 1, lb) !== 0) return []
  if (SafeArrayGetUBound(sa, 1, ub) !== 0) return []
  const n = ub[0] - lb[0] + 1
  if (n <= 0) return []
  const pd = [null]
  if (SafeArrayAccessData(sa, pd) !== 0) return []
  // NOTE: do NOT use koffi.view() here. It builds an external ArrayBuffer, and
  // Electron's V8 forbids those (napi_no_external_buffers_allowed) — koffi then
  // aborts the whole process with a napi fatal error. decode() copies instead.
  const nums: number[] = []
  for (let i = 0; i < n; i++) nums.push(koffi.decode(pd[0], i * 8, 'double') as number)
  SafeArrayUnaccessData(sa)
  const rects: Rect[] = []
  for (let i = 0; i + 3 < nums.length; i += 4) {
    rects.push({ x: nums[i], y: nums[i + 1], w: nums[i + 2], h: nums[i + 3] })
  }
  return rects
}

function rectsFromRange(range: unknown): Rect[] {
  const sa = [null]
  vcall(range, V_Rng_GetBoundingRectangles, P_GetBoundingRectangles, sa)
  let r = sa[0] ? readRects(sa[0]) : []
  if (sa[0]) SafeArrayDestroy(sa[0])
  if (r.length) return r

  // A collapsed caret has zero width and yields no rects. Widen a clone one
  // character backwards so it has geometry, then read the end of that.
  const c = [null]
  vcall(range, V_Rng_Clone, P_Clone, c)
  if (!c[0]) return []
  const moved = [0]
  vcall(c[0], V_Rng_MoveEndpointByUnit, P_MoveEndpointByUnit, Endpoint_Start, TextUnit_Character, -1, moved)
  const sa2 = [null]
  vcall(c[0], V_Rng_GetBoundingRectangles, P_GetBoundingRectangles, sa2)
  r = sa2[0] ? readRects(sa2[0]) : []
  if (sa2[0]) SafeArrayDestroy(sa2[0])
  release(c[0])
  return r
}

// Field text can be long; don't marshal an entire document for a few words of
// prediction context.
const MAX_BSTR_CHARS = 8192

/**
 * Read a BSTR out-param as a JS string and release it.
 *
 * NOTE: do NOT use koffi.decode(ptr, 'str16') here. Like koffi.view(), it aborts
 * the Electron process outright (napi fatal, no catchable error) — verified with
 * scripts/bstr-decode-test.cjs. Integer decodes are safe, so read UTF-16 code
 * units one at a time using the BSTR's own length prefix.
 */
function takeBstr(out: [unknown]): string {
  const p = out[0]
  if (!p) return ''
  try {
    const len = Math.min(Number(SysStringLen(p)) || 0, MAX_BSTR_CHARS)
    if (len <= 0) return ''
    const units: number[] = new Array(len)
    for (let i = 0; i < len; i++) {
      units[i] = koffi.decode(p, i * 2, 'uint16') as number
    }
    // Chunked to avoid blowing the argument limit on long fields
    let s = ''
    for (let i = 0; i < units.length; i += 4096) {
      s += String.fromCharCode(...units.slice(i, i + 4096))
    }
    return s
  } catch {
    return ''
  } finally {
    try { SysFreeString(p) } catch { /* ignore */ }
  }
}

export interface FieldText {
  /** Everything in the field before the caret — including text Glide never saw typed. */
  before: string
  /** Everything after the caret. */
  after: string
}

/**
 * The full contents of the focused text field, split at the caret.
 *
 * This is what makes predictions aware of context the keystroke buffer can't
 * know: text that was already there, pasted text, the paragraph above, the rest
 * of the function. Costs a few milliseconds and zero tokens of overhead.
 */
export function getFocusedFieldText(): FieldText | null {
  const automation = getAutomation()
  if (!automation) return null

  let el: unknown = null
  let pat: unknown = null
  let docRange: unknown = null
  let ranges: unknown = null
  let selRange: unknown = null
  let beforeRange: unknown = null
  let afterRange: unknown = null

  try {
    const elO = [null]
    if (vcall(automation, V_GetFocusedElement, P_GetFocusedElement, elO) !== 0 || !elO[0]) return null
    el = elO[0]

    for (const patternId of [UIA_TextPatternId, UIA_TextEditPatternId]) {
      const pO = [null]
      if (vcall(el, V_El_GetCurrentPattern, P_GetCurrentPattern, patternId, pO) !== 0) continue
      if (pO[0]) { pat = pO[0]; break }
    }
    if (!pat) return null

    const docO = [null]
    if (vcall(pat, V_Text_get_DocumentRange, P_get_DocumentRange, docO) !== 0 || !docO[0]) return null
    docRange = docO[0]

    // Caret / selection position within the document
    const rO = [null]
    if (vcall(pat, V_Text_GetSelection, P_GetSelection, rO) !== 0 || !rO[0]) return null
    ranges = rO[0]
    const len = [0]
    vcall(ranges, V_Arr_get_Length, P_get_Length, len)
    if (len[0] < 1) return null
    const sO = [null]
    if (vcall(ranges, V_Arr_GetElement, P_GetElement, 0, sO) !== 0 || !sO[0]) return null
    selRange = sO[0]

    // before = [document start, caret)
    const bO = [null]
    vcall(docRange, V_Rng_Clone, P_Clone, bO)
    if (!bO[0]) return null
    beforeRange = bO[0]
    // MoveEndpointByRange(End=1, selRange, Start=0)
    vcall(beforeRange, V_Rng_MoveEndpointByRange, P_MoveEndpointByRange, 1, selRange, 0)
    const bTextO: [unknown] = [null]
    vcall(beforeRange, V_Rng_GetText, P_GetText, -1, bTextO)
    const before = takeBstr(bTextO)

    // after = [caret, document end)
    const aO = [null]
    vcall(docRange, V_Rng_Clone, P_Clone, aO)
    let after = ''
    if (aO[0]) {
      afterRange = aO[0]
      // MoveEndpointByRange(Start=0, selRange, End=1)
      vcall(afterRange, V_Rng_MoveEndpointByRange, P_MoveEndpointByRange, 0, selRange, 1)
      const aTextO: [unknown] = [null]
      vcall(afterRange, V_Rng_GetText, P_GetText, -1, aTextO)
      after = takeBstr(aTextO)
    }

    if (!before && !after) return null
    return { before, after }
  } catch {
    return null
  } finally {
    release(afterRange)
    release(beforeRange)
    release(selRange)
    release(ranges)
    release(docRange)
    release(pat)
    release(el)
  }
}

export interface UiaCaret { x: number; y: number; h: number }

/**
 * Screen-space caret position of the focused text control, or null when the
 * focused element exposes no text pattern (buttons, panes, canvases…).
 */
export function getCaretViaUia(): UiaCaret | null {
  const automation = getAutomation()
  if (!automation) return null

  let el: unknown = null
  let pat: unknown = null
  let ranges: unknown = null
  let range: unknown = null

  try {
    const elO = [null]
    if (vcall(automation, V_GetFocusedElement, P_GetFocusedElement, elO) !== 0 || !elO[0]) return null
    el = elO[0]

    // TextPattern first, TextEdit as a fallback (some controls only expose one)
    for (const patternId of [UIA_TextPatternId, UIA_TextEditPatternId]) {
      const pO = [null]
      if (vcall(el, V_El_GetCurrentPattern, P_GetCurrentPattern, patternId, pO) !== 0) continue
      if (pO[0]) { pat = pO[0]; break }
    }
    if (!pat) return null

    const rO = [null]
    if (vcall(pat, V_Text_GetSelection, P_GetSelection, rO) !== 0 || !rO[0]) return null
    ranges = rO[0]

    const len = [0]
    vcall(ranges, V_Arr_get_Length, P_get_Length, len)
    if (len[0] < 1) return null

    const r0 = [null]
    if (vcall(ranges, V_Arr_GetElement, P_GetElement, 0, r0) !== 0 || !r0[0]) return null
    range = r0[0]

    const rects = rectsFromRange(range)
    if (!rects.length) return null

    // Caret sits at the trailing edge of the last rect
    const last = rects[rects.length - 1]
    if (last.h <= 0) return null
    return { x: Math.round(last.x + last.w), y: Math.round(last.y), h: Math.round(last.h) }
  } catch {
    return null
  } finally {
    release(range)
    release(ranges)
    release(pat)
    release(el)
  }
}
