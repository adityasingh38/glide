import Anthropic from '@anthropic-ai/sdk'
import { readSettings } from './store'

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
- Never start your completion with a space (the user's buffer already ends before the cursor)
- Never add quotes, commentary, or explanation
- If the context is code, complete code; if prose, complete prose`

export async function streamCompletion(
  buffer: string,
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

  // Only send the last 600 chars as context to keep latency low
  const context = buffer.length > 600 ? buffer.slice(-600) : buffer

  try {
    const stream = getClient().messages.stream({
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Text so far: ${JSON.stringify(context)}\n\nContinue:` }]
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
