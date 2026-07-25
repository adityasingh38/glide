/**
 * Verify keycode -> char mapping round-trips for every printable key we claim to
 * support. The old arithmetic version silently produced garbage; this asserts.
 */
const { UiohookKey: K } = require('uiohook-napi')

const LETTER_BY_KEYCODE = {}
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const code = K[ch.toUpperCase()]
  if (typeof code === 'number') LETTER_BY_KEYCODE[code] = ch
}

const digitMap = {
  [K['0']]: ['0', ')'], [K['1']]: ['1', '!'], [K['2']]: ['2', '@'],
  [K['3']]: ['3', '#'], [K['4']]: ['4', '$'], [K['5']]: ['5', '%'],
  [K['6']]: ['6', '^'], [K['7']]: ['7', '&'], [K['8']]: ['8', '*'],
  [K['9']]: ['9', '(']
}
const punctMap = {
  [K.Space]: [' ', ' '], [K.Comma]: [',', '<'], [K.Period]: ['.', '>'],
  [K.Slash]: ['/', '?'], [K.Semicolon]: [';', ':'], [K.Quote]: ["'", '"'],
  [K.BracketLeft]: ['[', '{'], [K.BracketRight]: [']', '}'],
  [K.Backslash]: ['\\', '|'], [K.Backquote]: ['`', '~'],
  [K.Equal]: ['=', '+'], [K.Minus]: ['-', '_']
}

function keycodeToChar(keycode, shift) {
  const letter = LETTER_BY_KEYCODE[keycode]
  if (letter) return shift ? letter.toUpperCase() : letter
  if (keycode in digitMap) return digitMap[keycode][shift ? 1 : 0]
  if (keycode in punctMap) return punctMap[keycode][shift ? 1 : 0]
  return ''
}

let fails = 0

// Every letter must round-trip in both cases
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const code = K[ch.toUpperCase()]
  const lower = keycodeToChar(code, false)
  const upper = keycodeToChar(code, true)
  if (lower !== ch || upper !== ch.toUpperCase()) {
    console.log(`FAIL letter ${ch}: code=${code} got lower=${JSON.stringify(lower)} upper=${JSON.stringify(upper)}`)
    fails++
  }
}

// Digits
for (const d of '0123456789') {
  const got = keycodeToChar(K[d], false)
  if (got !== d) { console.log(`FAIL digit ${d}: got ${JSON.stringify(got)}`); fails++ }
}

// Reconstruct a real sentence the way the tracker would
const sentence = 'the weather today is '
let rebuilt = ''
for (const ch of sentence) {
  const code = ch === ' ' ? K.Space : K[ch.toUpperCase()]
  rebuilt += keycodeToChar(code, false)
}
console.log('typed   :', JSON.stringify(sentence))
console.log('rebuilt :', JSON.stringify(rebuilt))
if (rebuilt !== sentence) { console.log('FAIL sentence mismatch'); fails++ }

// Mixed case + punctuation
const mixed = [
  ['H', K.H, true], ['i', K.I, false], [',', K.Comma, false], [' ', K.Space, false],
  ['I', K.I, true], ["'", K.Quote, false], ['m', K.M, false], [' ', K.Space, false],
  ['A', K.A, true], ['.', K.Period, false]
]
const mixedOut = mixed.map(([, code, sh]) => keycodeToChar(code, sh)).join('')
const mixedWant = mixed.map(([ch]) => ch).join('')
console.log('mixed   :', JSON.stringify(mixedOut), mixedOut === mixedWant ? 'OK' : 'FAIL')
if (mixedOut !== mixedWant) fails++

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
