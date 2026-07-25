import koffi from 'koffi'

const user32 = koffi.load('user32.dll')

// ── Structs ────────────────────────────────────────────────────────────────

const RECT = koffi.struct('RECT', {
  left: 'int',
  top: 'int',
  right: 'int',
  bottom: 'int'
})

const POINT = koffi.struct('POINT', {
  x: 'int',
  y: 'int'
})

const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
  cbSize: 'uint',
  flags: 'uint',
  hwndActive: 'void *',
  hwndFocus: 'void *',
  hwndCapture: 'void *',
  hwndMenuOwner: 'void *',
  hwndMoveSize: 'void *',
  hwndCaret: 'void *',
  rcCaret: RECT
})

// ── Functions ──────────────────────────────────────────────────────────────

const GetGUIThreadInfo = user32.func('int GetGUIThreadInfo(uint idThread, _Inout_ GUITHREADINFO *pgui)')
const ClientToScreen = user32.func('int ClientToScreen(void *hWnd, _Inout_ POINT *lpPoint)')
const SendInput = user32.func('uint SendInput(uint nInputs, void *pInputs, int cbSize)')
const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)')

// ── Public API ─────────────────────────────────────────────────────────────

export interface CaretScreenPos {
  x: number
  y: number
  h: number   // caret height for positioning suggestion below
}

export function getCaretScreenPos(): CaretScreenPos | null {
  const gti = {
    cbSize: 0, flags: 0,
    hwndActive: null, hwndFocus: null, hwndCapture: null,
    hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null,
    rcCaret: { left: 0, top: 0, right: 0, bottom: 0 }
  }
  gti.cbSize = koffi.sizeof(GUITHREADINFO)
  const ok = GetGUIThreadInfo(0, gti)
  if (!ok || !gti.hwndCaret) return null

  const r = gti.rcCaret
  const pt = { x: r.left, y: r.top }
  ClientToScreen(gti.hwndCaret, pt)

  return { x: pt.x, y: pt.y, h: Math.max(r.bottom - r.top, 16) }
}

// INPUT struct is 40 bytes on x64 Windows:
//   offset 0: type (DWORD = 4)
//   offset 4: 4-byte padding (union alignment)
//   offset 8: union starts → KEYBDINPUT.wVk (WORD)
//   offset 10: KEYBDINPUT.wScan (WORD)
//   offset 12: KEYBDINPUT.dwFlags (DWORD)
//   offset 16: KEYBDINPUT.time (DWORD)
//   offset 24: KEYBDINPUT.dwExtraInfo (ULONG_PTR = 8)
const INPUT_SIZE = 40
const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002

function makeVkInput(vk: number, up: boolean): Buffer {
  const buf = Buffer.alloc(INPUT_SIZE, 0)
  buf.writeUInt32LE(INPUT_KEYBOARD, 0)
  buf.writeUInt16LE(vk, 8)          // wVk
  buf.writeUInt32LE(up ? KEYEVENTF_KEYUP : 0, 12)  // dwFlags
  return buf
}

export function getForegroundHwnd(): unknown {
  try { return GetForegroundWindow() } catch { return null }
}

export function getActiveWindowTitle(): string {
  try {
    const hwnd = GetForegroundWindow()
    if (!hwnd) return ''
    const buf = Buffer.alloc(1024)
    const len = GetWindowTextW(hwnd, buf, 512)
    if (len <= 0) return ''
    return buf.toString('utf16le', 0, len * 2)
  } catch {
    return ''
  }
}

export function sendCtrlV(): void {
  const VK_CONTROL = 0x11
  const VK_V = 0x56
  // 4 inputs: Ctrl↓  V↓  V↑  Ctrl↑
  const buf = Buffer.concat([
    makeVkInput(VK_CONTROL, false),
    makeVkInput(VK_V, false),
    makeVkInput(VK_V, true),
    makeVkInput(VK_CONTROL, true)
  ])
  SendInput(4, buf, INPUT_SIZE)
}
