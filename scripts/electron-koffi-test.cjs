/**
 * Does koffi.call() (calling a raw function pointer) work under Electron's napi?
 * It works under plain node — the UIA probe proved that — but the app crashes
 * with `FATAL ERROR: Error::New napi_get_last_error_info`, so the Electron ABI
 * is the suspect.
 *
 * Run:  ./node_modules/electron/dist/electron.exe scripts/electron-koffi-test.cjs
 * Result lands in scripts/koffi-test-result.txt
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'koffi-test-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  let koffi
  try {
    koffi = require('koffi')
    say('koffi loaded, version ' + require('koffi/package.json').version)
  } catch (e) {
    say('FAIL require koffi: ' + e.message)
    return app.exit(1)
  }

  // 1. Baseline: a normal .func() call (this already works in the app today)
  let user32, GetForegroundWindow, hwnd
  try {
    user32 = koffi.load('user32.dll')
    GetForegroundWindow = user32.func('void *GetForegroundWindow()')
    hwnd = GetForegroundWindow()
    say('1. func() call OK, hwnd addr=' + String(koffi.address(hwnd)))
  } catch (e) {
    say('1. FAIL func(): ' + e.message)
    return app.exit(1)
  }

  // 2. koffi.proto — declaring a callable prototype
  let proto
  try {
    proto = koffi.proto('void *GFW_probe()')
    say('2. proto() OK')
  } catch (e) {
    say('2. FAIL proto(): ' + e.message)
    return app.exit(1)
  }

  // 3. Resolve a real function address, then koffi.call() it.
  //    This is the exact primitive the UIA vtable dispatch relies on.
  try {
    const kernel32 = koffi.load('kernel32.dll')
    const GetModuleHandleA = kernel32.func('void *GetModuleHandleA(const char *name)')
    const GetProcAddress = kernel32.func('void *GetProcAddress(void *mod, const char *name)')
    const mod = GetModuleHandleA('user32.dll')
    say('3a. GetModuleHandleA OK addr=' + String(koffi.address(mod)))
    const fnAddr = GetProcAddress(mod, 'GetForegroundWindow')
    say('3b. GetProcAddress OK addr=' + String(koffi.address(fnAddr)))
    const r = koffi.call(fnAddr, proto)
    say('3c. koffi.call() OK -> ' + String(koffi.address(r)))
  } catch (e) {
    say('3. FAIL koffi.call(): ' + e.message)
    return app.exit(1)
  }

  // 4. koffi.decode on a pointer-to-pointer (reading a vtable slot)
  try {
    const ole32 = koffi.load('ole32.dll')
    const CoInitializeEx = ole32.func('long CoInitializeEx(void *r, uint32 c)')
    const CoCreateInstance = ole32.func(
      'long CoCreateInstance(const void *rclsid, void *pUnkOuter, uint32 ctx, const void *riid, _Out_ void **ppv)'
    )
    function guid(str) {
      const h = str.replace(/[{}-]/g, '')
      const b = Buffer.alloc(16)
      b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0)
      b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4)
      b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6)
      for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)
      return b
    }
    CoInitializeEx(null, 2)
    const out = [null]
    const hr = CoCreateInstance(
      guid('{FF48DBA4-60EF-4201-AA87-54103EEF594E}'), null, 1,
      guid('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}'), out
    )
    say('4a. CoCreateInstance hr=' + hr + ' ptr=' + (out[0] ? 'yes' : 'no'))
    if (out[0]) {
      const vtbl = koffi.decode(out[0], 'void *')
      say('4b. decode vtable OK addr=' + String(koffi.address(vtbl)))
      const slot8 = koffi.decode(vtbl, 8 * 8, 'void *')
      say('4c. decode slot8 OK addr=' + String(koffi.address(slot8)))
      const P = koffi.proto('long GetFocusedElement(void *self, _Out_ void **el)')
      const elO = [null]
      const hr2 = koffi.call(slot8, P, out[0], elO)
      say('4d. vtable koffi.call OK hr=' + hr2 + ' el=' + (elO[0] ? 'yes' : 'no'))
    }
  } catch (e) {
    say('4. FAIL COM: ' + e.message)
    return app.exit(1)
  }

  say('ALL PASS')
  app.exit(0)
})
