/**
 * Is koffi.decode(ptr, 'str16') fatal under Electron, the way koffi.view() was?
 * Compares it against a manual uint16 loop (integer decodes are known-safe).
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/bstr-decode-test.cjs
 */
const { app } = require('electron')
const koffi = require('koffi')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'bstr-test-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

const oleaut32 = koffi.load('oleaut32.dll')
const SysAllocString = oleaut32.func('void *SysAllocString(const char16_t *s)')
const SysStringLen = oleaut32.func('uint32 SysStringLen(void *bstr)')
const SysFreeString = oleaut32.func('void SysFreeString(void *bstr)')

app.whenReady().then(() => {
  const sample = 'hello field text — ünicode ok'
  const bstr = SysAllocString(sample)
  say(`allocated BSTR, SysStringLen=${SysStringLen(bstr)} (expected ${sample.length})`)

  // Approach A: manual uint16 loop (only integer decodes)
  try {
    const len = SysStringLen(bstr)
    let s = ''
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(koffi.decode(bstr, i * 2, 'uint16'))
    }
    say(`A. manual uint16 loop OK -> ${JSON.stringify(s)}  match=${s === sample}`)
  } catch (e) {
    say(`A. manual loop FAILED: ${e.message}`)
  }

  // Approach B: koffi 'str16' decode  <-- the suspect
  say('B. about to try koffi.decode(ptr, "str16") — if the file ends here, it is fatal')
  try {
    const s = koffi.decode(bstr, 'str16')
    say(`B. str16 decode OK -> ${JSON.stringify(s)}`)
  } catch (e) {
    say(`B. str16 decode threw (catchable): ${e.message}`)
  }

  SysFreeString(bstr)
  say('DONE')
  app.exit(0)
})
