/**
 * Is getForegroundWindowId() stable for an unchanging foreground window?
 * If these 10 samples aren't identical, the window-change reset fires spuriously
 * and cancels every in-flight prediction.
 */
const koffi = require('koffi')
const user32 = koffi.load('user32.dll')
const GetForegroundWindow = user32.func('void *GetForegroundWindow()')

console.log('koffi.address is', typeof koffi.address)

const ids = []
for (let i = 0; i < 10; i++) {
  const h = GetForegroundWindow()
  let id
  try {
    id = h ? String(koffi.address(h)) : ''
  } catch (e) {
    id = 'THREW: ' + e.message
  }
  ids.push(id)
}

console.log('samples:', JSON.stringify(ids, null, 0))
const unique = [...new Set(ids)]
console.log('unique count:', unique.length, unique.length === 1 ? '=> STABLE' : '=> UNSTABLE (bug)')

// Also confirm raw handle objects are NOT comparable (the original bug)
const a = GetForegroundWindow()
const b = GetForegroundWindow()
console.log('raw handles equal with !== ?', a === b ? 'equal (fine)' : 'NOT equal (this was the bug)')
