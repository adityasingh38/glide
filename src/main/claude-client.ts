import Anthropic from '@anthropic-ai/sdk'
import { readSettings } from './store'
import { log } from './log'

export interface CompletionContext {
  clipboard?: string
  screenB64?: string
  windowTitle?: string
  /** Text sitting after the caret — the completion has to fit in front of it. */
  textAfterCaret?: string
  /** Recently accepted completions, used as few-shot examples of the user's voice. */
  examples?: Array<{ before: string; completion: string }>
}

let client: Anthropic | null = null
let lastKey = ''

function getClient(): Anthropic {
  const { apiKey } = readSettings()
  if (!client || apiKey !== lastKey) {
    client = new Anthropic({ apiKey })
    lastKey = apiKey
  }
  return client
}

// Kept deliberately terse — every input token adds time-to-first-token, and TTFT
// is the whole user experience here. Measured: 851ms with this vs 1111ms for a
// verbose version of the same rules.
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

function buildSystem(userFacts: string): string {
  const facts = userFacts.trim()
  if (!facts) return SYSTEM_BASE
  return `${SYSTEM_BASE}\n\nABOUT THE USER (the human typing — use these facts when relevant):\n${facts}`
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const { apiKey, model } = readSettings()
  if (!apiKey) return { ok: false, error: 'No API key set' }
  try {
    const c = new Anthropic({ apiKey })
    await c.messages.create({
      model,
      max_tokens: 1,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'Hi' }]
    })
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export async function streamCompletion(
  buffer: string,
  context: CompletionContext,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal: AbortSignal
): Promise<void> {
  const { model, maxTokens, apiKey, userFacts } = readSettings()
  if (!apiKey) {
    onError(new Error('No API key — open Settings to add one'))
    return
  }
  const system = buildSystem(userFacts ?? '')

  const textCtx = buffer.length > 600 ? buffer.slice(-600) : buffer

  type CacheControl = { cache_control?: { type: 'ephemeral' } }
  type TextBlock = { type: 'text'; text: string } & CacheControl
  type ImageBlock = {
    type: 'image'
    source: { type: 'base64'; media_type: 'image/jpeg'; data: string }
  } & CacheControl
  const content: Array<TextBlock | ImageBlock> = []

  // Screenshots are JPEG — half the bytes of PNG for the same legibility.
  // Label it explicitly: an unlabelled image makes the model continue text it
  // sees on screen instead of the user's sentence.
  //
  // cache_control matters enormously: the same frame is reused for ~20s, and
  // caching it took TTFT from 1270ms to 847ms on Haiku.
  if (context.screenB64) {
    content.push({ type: 'text', text: '[REFERENCE ONLY — the user\'s screen. Learn facts from it. Never continue text shown in it.]' })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: context.screenB64 },
      cache_control: { type: 'ephemeral' }
    })
  }

  if (context.windowTitle) {
    content.push({ type: 'text', text: `[REFERENCE ONLY — active window: ${context.windowTitle}]` })
  }

  if (context.clipboard) {
    content.push({ type: 'text', text: `[REFERENCE ONLY — clipboard: ${context.clipboard.slice(0, 800)}]` })
  }

  // Past accepted completions teach the user's actual voice far more cheaply than
  // any description of it could.
  if (context.examples?.length) {
    const shown = context.examples.slice(-6)
      .map(e => `  ${JSON.stringify(e.before.slice(-60))} -> ${JSON.stringify(e.completion)}`)
      .join('\n')
    content.push({
      type: 'text',
      text: `[REFERENCE ONLY — completions this user previously accepted, match this voice:\n${shown}\n]`
    })
  }

  if (context.textAfterCaret) {
    content.push({
      type: 'text',
      text: `[Text already AFTER the caret — your completion must lead naturally into it, and must not duplicate it: ${JSON.stringify(context.textAfterCaret)}]`
    })
  }

  // The instruction goes LAST so it's the most recent thing in context
  content.push({
    type: 'text',
    text: `TYPING: ${JSON.stringify(textCtx)}\n\nContinue TYPING only. Output the next few words:`
  })

  try {
    const stream = getClient().messages.stream({
      model,
      max_tokens: maxTokens,
      // Cache the system prompt too — it only changes when the user edits their facts
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      // Extended thinking is fatal here: Sonnet 5 spent the whole 40-token budget
      // on a thinking block and emitted no text at all
      // (stop_reason=max_tokens, blocks=[thinking, signature_delta]).
      // Keystroke prediction wants an instant reflex, not deliberation.
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content }]
    })

    signal.addEventListener('abort', () => stream.abort())

    let textTokens = 0
    const otherBlocks: string[] = []
    let stopReason: string | null = null

    for await (const chunk of stream) {
      if (signal.aborted) break

      if (chunk.type === 'content_block_start') {
        const t = chunk.content_block?.type
        if (t && t !== 'text') otherBlocks.push(t)
      }

      if (chunk.type === 'message_delta') {
        stopReason = chunk.delta?.stop_reason ?? stopReason
      }

      if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          textTokens++
          onToken(chunk.delta.text)
        } else if (!otherBlocks.includes(chunk.delta.type)) {
          otherBlocks.push(chunk.delta.type)
        }
      }
    }

    // An empty completion is a real failure mode worth explaining, not hiding:
    // e.g. the token budget being consumed by a non-text (thinking) block.
    if (!signal.aborted && textTokens === 0) {
      log(`EMPTY completion — stop_reason=${stopReason} nonTextBlocks=[${otherBlocks.join(',')}] maxTokens=${maxTokens} model=${model}`)
    }

    if (!signal.aborted) onDone()
  } catch (err) {
    if (!signal.aborted) onError(err as Error)
  }
}
