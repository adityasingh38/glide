/**
 * Measure TIME TO FIRST TOKEN — the only latency the user actually feels.
 *
 * Compares: model (Sonnet 5 vs Haiku 4.5) x screenshot (on/off) x prompt caching.
 * The screenshot costs ~2000 input tokens, and input size drives TTFT, so caching
 * it should matter a lot.
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/latency-bench.cjs
 */
const { app, desktopCapturer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(__dirname, 'latency-bench-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')); }

const SYSTEM_LONG = `You continue the sentence a user is currently typing.

WHAT TO CONTINUE
The message contains a line beginning "TYPING:" — that, and only that, is the text
you continue. Everything else is background reference.

REFERENCE MATERIAL (never something to continue)
- A screenshot may be attached. It shows the user's screen. Use it ONLY to learn
  facts — who they are, the project, the app, the code style, names on screen.
  NEVER continue, quote, or echo text you see in the screenshot. It is not what
  they are typing. Text on screen is evidence about the user, not their sentence.
- Clipboard text: something they just copied and may reference. Same rule.
- Window title: tells you the app, so you match register — a code editor wants
  code, a chat box wants prose, a terminal wants a command.

OUTPUT
- Output ONLY the next 2–8 words that follow TYPING. Nothing else.
- No quotes, no preamble, no explanation, no commentary.
- NEVER refuse. NEVER say you lack context. If unsure, give your best guess —
  a wrong guess is more useful than any explanation.
- Do NOT repeat words already present in TYPING. Do NOT begin with a space.
- Match TYPING's language, tense, capitalisation and register exactly.
- If a fact from the reference material answers TYPING (for example the user's
  own name when they are introducing themselves), prefer that concrete fact over
  a generic invention.`

// A terse variant — fewer input tokens should mean lower TTFT
const SYSTEM_SHORT = `Continue the text after "TYPING:". Output only the next 2-8 words.
A screenshot, if present, is REFERENCE ONLY — learn facts from it, never continue text shown in it.
No preamble, no quotes, no explanation. Never refuse; guess if unsure.
Don't repeat words already in TYPING. Don't start with a space. Match its language and register.`

const BUFFERS = ['it is raining in', 'Hey, my name is', 'the meeting is scheduled for']

app.whenReady().then(async () => {
  const sp = path.join(os.homedir(), 'AppData', 'Roaming', 'Glide', 'settings.json')
  let raw = fs.readFileSync(sp, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const s = JSON.parse(raw)

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })
  const bigShot = sources[0].thumbnail
  const b64Full = bigShot.toJPEG(72).toString('base64')
  // A smaller frame: fewer vision tokens, still legible?
  const small = bigShot.resize({ width: 1024, height: 576 })
  const b64Small = small.toJPEG(70).toString('base64')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: s.apiKey })

  say(`full screenshot ${Math.round(b64Full.length / 1024)}KB | small ${Math.round(b64Small.length / 1024)}KB`)
  say('metric = ms to FIRST TEXT TOKEN (median of 3)\n')

  async function ttft({ model, image, system, cache, label }) {
    const runs = []
    let sample = ''
    let usage = null
    for (let i = 0; i < 3; i++) {
      const buffer = BUFFERS[i % BUFFERS.length]
      const content = []
      if (image) {
        const imgBlock = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }
        if (cache) imgBlock.cache_control = { type: 'ephemeral' }
        content.push({ type: 'text', text: "[REFERENCE ONLY — the user's screen.]" })
        content.push(imgBlock)
      }
      content.push({ type: 'text', text: `TYPING: ${JSON.stringify(buffer)}\n\nContinue TYPING only:` })

      const sys = cache
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system

      const t0 = Date.now()
      let first = null
      try {
        const stream = client.messages.stream({
          model, max_tokens: 32, system: sys,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content }]
        })
        let text = ''
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            if (first === null) first = Date.now() - t0
            text += chunk.delta.text
          }
        }
        const fm = await stream.finalMessage()
        usage = fm.usage
        sample = text
        runs.push(first === null ? -1 : first)
      } catch (e) {
        say(`  ${label}: ERROR ${e.message}`)
        return
      }
    }
    runs.sort((a, b) => a - b)
    const med = runs[1]
    const cacheInfo = usage
      ? ` in=${usage.input_tokens} cacheW=${usage.cache_creation_input_tokens ?? 0} cacheR=${usage.cache_read_input_tokens ?? 0}`
      : ''
    say(`  ${label.padEnd(46)} ${String(med).padStart(5)}ms  runs=[${runs.join(',')}]${cacheInfo}`)
    say(`  ${' '.repeat(46)} sample=${JSON.stringify(sample.slice(0, 42))}`)
  }

  const HAIKU = 'claude-haiku-4-5-20251001'
  const SONNET = 'claude-sonnet-5'

  say('--- Sonnet 5 ---')
  await ttft({ model: SONNET, image: b64Full, system: SYSTEM_LONG, cache: false, label: 'sonnet5 + full shot + long prompt' })
  await ttft({ model: SONNET, image: null,    system: SYSTEM_LONG, cache: false, label: 'sonnet5 + NO shot  + long prompt' })

  say('')
  say('--- Haiku 4.5 ---')
  await ttft({ model: HAIKU, image: b64Full,  system: SYSTEM_LONG,  cache: false, label: 'haiku + full shot + long prompt' })
  await ttft({ model: HAIKU, image: b64Small, system: SYSTEM_LONG,  cache: false, label: 'haiku + SMALL shot + long prompt' })
  await ttft({ model: HAIKU, image: null,     system: SYSTEM_LONG,  cache: false, label: 'haiku + NO shot  + long prompt' })
  await ttft({ model: HAIKU, image: null,     system: SYSTEM_SHORT, cache: false, label: 'haiku + NO shot  + SHORT prompt' })

  say('')
  say('--- prompt caching (image + system cached) ---')
  await ttft({ model: HAIKU,  image: b64Full, system: SYSTEM_LONG, cache: true, label: 'haiku + full shot + CACHED' })
  await ttft({ model: SONNET, image: b64Full, system: SYSTEM_LONG, cache: true, label: 'sonnet5 + full shot + CACHED' })

  say('')
  say('DONE')
  app.exit(0)
})
