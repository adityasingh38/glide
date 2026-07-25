/**
 * Confirm extended thinking was eating the token budget, and that disabling it
 * fixes the empty completions.
 *
 * Reproduces the app's ACTUAL request: full system prompt + real screenshot.
 * (An earlier repro used a short prompt and no image, so thinking stayed brief
 * and the bug didn't show — which sent me down the wrong path.)
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/thinking-check.cjs
 */
const { app, desktopCapturer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(__dirname, 'thinking-check-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

const SYSTEM = `You continue the sentence a user is currently typing.

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

app.whenReady().then(async () => {
  const sp = path.join(os.homedir(), 'AppData', 'Roaming', 'Glide', 'settings.json')
  let raw = fs.readFileSync(sp, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const s = JSON.parse(raw)

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })
  const b64 = sources[0].thumbnail.toJPEG(72).toString('base64')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: s.apiKey })

  say(`model=${s.model} maxTokens=${s.maxTokens} screenshot=${Math.round(b64.length / 1024)}KB`)

  const buffers = ['it is raining in ahmedabad', 'Hey, my name is', 'i am working on a project called']

  for (const disabled of [false, true]) {
    say('')
    say('#'.repeat(60))
    say(disabled ? '### thinking: DISABLED' : '### thinking: default (as the bug occurred)')
    for (const buffer of buffers) {
      const content = [
        { type: 'text', text: "[REFERENCE ONLY — the user's screen. Learn facts from it. Never continue text shown in it.]" },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: `TYPING: ${JSON.stringify(buffer)}\n\nContinue TYPING only. Output the next few words:` }
      ]
      const req = { model: s.model, max_tokens: s.maxTokens, system: SYSTEM, messages: [{ role: 'user', content }] }
      if (disabled) req.thinking = { type: 'disabled' }

      try {
        const msg = await client.messages.create(req)
        const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
        const blocks = msg.content.map(b => b.type)
        say(`  ${JSON.stringify(buffer).padEnd(36)}`)
        say(`      text=${JSON.stringify(text)}`)
        say(`      blocks=${JSON.stringify(blocks)} stop=${msg.stop_reason} out=${msg.usage.output_tokens}`)
      } catch (e) {
        say(`  ${JSON.stringify(buffer).padEnd(36)} ERROR ${e.message}`)
      }
    }
  }
  say('')
  say('DONE')
  app.exit(0)
})
