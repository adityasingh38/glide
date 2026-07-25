/**
 * Unit-test the suggestion reconciliation, including the case that was silently
 * throwing away correct completions:
 *
 *   requested from "…no sugges", stream has only "t", user already typed "tion"
 *   -> old code called that "diverged"; it must be "waiting".
 */

function reconcile(requestedFrom, suggestion, buf) {
  if (!buf.startsWith(requestedFrom)) return { state: 'diverged' }
  const typedSince = buf.slice(requestedFrom.length)
  if (typedSince.length === 0) {
    return suggestion ? { state: 'show', text: suggestion } : { state: 'waiting' }
  }
  if (!suggestion) return { state: 'waiting' }
  let waiting = false
  for (const cand of [suggestion, ' ' + suggestion]) {
    if (cand.startsWith(typedSince)) {
      const rest = cand.slice(typedSince.length)
      return rest ? { state: 'show', text: rest } : { state: 'waiting' }
    }
    if (typedSince.startsWith(cand)) waiting = true
  }
  return waiting ? { state: 'waiting' } : { state: 'diverged' }
}

const cases = [
  // [name, requestedFrom, suggestion, buffer, expectedState, expectedText]
  ['nothing typed since',        'the weather is', 'sunny today', 'the weather is',        'show', 'sunny today'],
  ['stream behind typing (BUG)', 'no sugges',      't',           'no suggestion',          'waiting'],
  ['stream catches up',          'no sugges',      'tions appeared', 'no suggestion',       'show', 's appeared'],
  ['typed part of suggestion',   'the weather is', 'sunny today', 'the weather is sun',     'show', 'ny today'],
  ['typed all of suggestion',    'the weather is', 'sunny',       'the weather is sunny',   'waiting'],
  ['genuinely diverged',         'the weather is', 'sunny today', 'the weather is cold',    'diverged'],
  ['backspaced (prefix broken)', 'waited atleast 39', 'seconds',  'waited atleast 30',      'diverged'],
  ['empty suggestion yet',       'the weather is', '',            'the weather is',         'waiting'],
  ['empty suggestion, typed',    'the weather is', '',            'the weather is s',       'waiting'],
]

let fails = 0
for (const [name, from, sugg, buf, wantState, wantText] of cases) {
  const r = reconcile(from, sugg, buf)
  const okState = r.state === wantState
  const okText = wantText === undefined || r.text === wantText
  const ok = okState && okText
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) {
    console.log(`        want ${wantState}${wantText !== undefined ? ' ' + JSON.stringify(wantText) : ''}`)
    console.log(`        got  ${r.state}${r.text !== undefined ? ' ' + JSON.stringify(r.text) : ''}`)
  }
}

// The real sequence from the log, token by token
console.log('\n--- replaying the logged failure token-by-token ---')
const from = 'waited atleast 30 secs, no sugges'
const finalBuf = 'waited atleast 30 secs, no suggestion'
let sugg = ''
let shown = null
for (const tok of ['t', 'ions', ' appeared', ' at', ' all']) {
  sugg += tok
  const r = reconcile(from, sugg, finalBuf)
  console.log(`  suggestion=${JSON.stringify(sugg).padEnd(30)} -> ${r.state}${r.text ? ' ' + JSON.stringify(r.text) : ''}`)
  if (r.state === 'diverged') { console.log('  FAIL: discarded a valid suggestion'); fails++; break }
  if (r.state === 'show') shown = r.text
}
console.log(`  final shown: ${JSON.stringify(shown)}`)
if (shown !== 's appeared at all') { console.log('  FAIL: expected "s appeared at all"'); fails++ }

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
