/**
 * Does the model still introduce ITSELF for "my name is"?
 *
 * It was answering "Claude, an AI assistant made by Anthropic" — it saw a Claude
 * conversation on screen and assumed it was the speaker. Tests the hardened
 * prompt with and without personal facts, against a live screenshot.
 *
 * Run: ./node_modules/electron/dist/electron.exe scripts/identity-check.cjs
 */
const { app, desktopCapturer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(__dirname, 'identity-check-result.txt')
const lines = []
function say(s) { lines.push(s); fs.writeFileSync(OUT, lines.join('\n')) }

const SYSTEM_BASE = `You are a keyboard autocomplete engine. You are NOT a chat participant.

A HUMAN is typing. "I", "me", "my" in TYPING refer to THAT HUMAN — never to you.
Never speak as yourself, never introduce yourself, and never say you are Claude,
an AI, an assistant, or made by Anthropic. You have no name here.
If TYPING is the human introducing themselves ("my name is"), complete it with
THEIR name from ABOUT THE USER or the screen — never yours.

Continue the text after "TYPING:". Output only the next 2-8 words.

A screenshot or clipboard text, if present, is REFERENCE ONLY: learn facts from it
(the user's name, project, code style, app) but NEVER continue or echo text shown
in it. A chat conversation visible on screen is NOT yours to reply to.
Only TYPING is the sentence being written.

No preamble, no quotes, no explanation. Never refuse — guess if unsure.
Don't repeat words already in TYPING. Don't start with a space.
Match TYPING's language, tense, capitalisation and register.
Prefer a concrete fact from the reference material over a generic invention.`

const OLD_SYSTEM = `Continue the text after "TYPING:". Output only the next 2-8 words.

A screenshot or clipboard text, if present, is REFERENCE ONLY: learn facts from it
(the user's name, project, code style, app) but NEVER continue or echo text shown
in it. Only TYPING is the sentence being written.

No preamble, no quotes, no explanation. Never refuse — guess if unsure.
Don't repeat words already in TYPING. Don't start with a space.
Match TYPING's language, tense, capitalisation and register.
Prefer a concrete fact from the reference material over a generic invention.`

const FACTS = 'My name is Aditya Singh.\nI build Surge, Glide and Kaafila.\nI work solo on Windows.'

const BUFFERS = ['my name is', 'Hey, my name is', 'hi, I am', 'my email is']

const BAD = /claude|anthropic|an ai|assistant|language model/i

app.whenReady().then(async () => {
  const sp = path.join(os.homedir(), 'AppData', 'Roaming', 'Glide', 'settings.json')
  let raw = fs.readFileSync(sp, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const s = JSON.parse(raw)

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
  const b64 = sources[0].thumbnail.toJPEG(72).toString('base64')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: s.apiKey })

  say(`model=${s.model} screenshot=${Math.round(b64.length / 1024)}KB`)
  say('FAIL = the completion mentions Claude/Anthropic/AI/assistant\n')

  const configs = [
    { label: 'OLD prompt, no facts   (the bug)', system: OLD_SYSTEM },
    { label: 'NEW prompt, no facts',              system: SYSTEM_BASE },
    { label: 'NEW prompt + facts',                system: `${SYSTEM_BASE}\n\nABOUT THE USER (the human typing — use these facts when relevant):\n${FACTS}` }
  ]

  for (const cfg of configs) {
    say('#'.repeat(58))
    say(`### ${cfg.label}`)
    for (const buffer of BUFFERS) {
      const content = [
        { type: 'text', text: "[REFERENCE ONLY — the user's screen. Learn facts from it. Never continue text shown in it.]" },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: `TYPING: ${JSON.stringify(buffer)}\n\nContinue TYPING only. Output the next few words:` }
      ]
      try {
        const msg = await client.messages.create({
          model: s.model, max_tokens: 32, system: cfg.system,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content }]
        })
        const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
        const bad = BAD.test(text)
        say(`  ${bad ? 'FAIL' : 'ok  '} ${JSON.stringify(buffer).padEnd(20)} -> ${JSON.stringify(text)}`)
      } catch (e) {
        say(`  ERR  ${JSON.stringify(buffer).padEnd(20)} -> ${e.message}`)
      }
    }
    say('')
  }
  say('DONE')
  app.exit(0)
})
