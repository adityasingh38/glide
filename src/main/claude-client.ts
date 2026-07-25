import Anthropic from '@anthropic-ai/sdk'
import { readSettings } from './store'

export interface CompletionContext {
  clipboard?: string
  screenB64?: string
  windowTitle?: string
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

const SYSTEM = `You are an inline typing assistant. Your only job is to predict what the user will type next.

Rules:
- Output ONLY the completion — nothing the user already typed
- 2–12 words maximum
- Match the user's tone and style exactly
- Never start your completion with a space
- Never add quotes, commentary, or explanation
- If the context is code, complete code; if prose, complete prose
- If clipboard content, a screenshot, or app context is provided, use it to infer the user's intent`

export async function streamCompletion(
  buffer: string,
  context: CompletionContext,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal: AbortSignal
): Promise<void> {
  const { model, maxTokens, apiKey } = readSettings()
  if (!apiKey) {
    onError(new Error('No API key — open Settings to add one'))
    return
  }

  const textCtx = buffer.length > 600 ? buffer.slice(-600) : buffer

  type TextBlock = { type: 'text'; text: string }
  type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
  const content: Array<TextBlock | ImageBlock> = []

  if (context.screenB64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: context.screenB64 } })
  }

  if (context.windowTitle) {
    content.push({ type: 'text', text: `[Active window: ${context.windowTitle}]` })
  }

  if (context.clipboard) {
    content.push({ type: 'text', text: `[Clipboard: ${context.clipboard.slice(0, 800)}]` })
  }

  content.push({ type: 'text', text: `Text so far: ${JSON.stringify(textCtx)}\n\nContinue:` })

  try {
    const stream = getClient().messages.stream({
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content }]
    })

    signal.addEventListener('abort', () => stream.abort())

    for await (const chunk of stream) {
      if (signal.aborted) break
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        onToken(chunk.delta.text)
      }
    }
    if (!signal.aborted) onDone()
  } catch (err) {
    if (!signal.aborted) onError(err as Error)
  }
}
