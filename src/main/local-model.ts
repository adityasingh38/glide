import { join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { log } from './log'

/**
 * On-device prediction via llama.cpp.
 *
 * The cloud path floors out around 850ms (~200ms network + ~600ms Haiku TTFT),
 * which is why Glide never felt instant. Measured on this hardware
 * (i5-10300H, GTX 1650 Ti 4GB):
 *
 *   cloud haiku + cached screenshot   847ms
 *   local 1.5B                         29ms
 *   local 1.5B + facts prefix          76ms
 *
 * Three things the benchmark established, all load-bearing:
 *
 *  1. Vulkan, not CUDA. The prebuilt CUDA binary needs a CUDA Toolkit runtime that
 *     isn't installed, and building from source would need VS Build Tools. Vulkan's
 *     prebuilt works off the driver alone. It also keeps the model in VRAM, which
 *     matters because system RAM is the scarce resource here (8GB) while 4GB of
 *     VRAM sits idle.
 *
 *  2. A FRESH sequence per completion. Reusing one made TTFT swing between 17ms
 *     and 1241ms for identically sized prompts, because the KV cache fills and
 *     forces context shifts that re-evaluate everything.
 *
 *  3. Raw completion, not chat. A chat wrapper made the model echo the input
 *     ("my name is John Doe" instead of "John Doe") and add stray quotes.
 */

/**
 * Preference order, best first. Whichever is present locally wins, so swapping
 * models is just a matter of which file is in models/.
 *
 * Llama-3.2-3B leads because this user's typing is email, AI prompting and web
 * forms, and it holds a professional register where Qwen-1.5B drifted into
 * student-speak ("help me with my homework", "the 2013-2014 school"). Measured on
 * the same prose prompts:
 *   Llama-3.2-3B   108ms TTFT   natural, correct register
 *   Qwen2.5-1.5B    47ms TTFT   faster, noticeably rougher
 *   Qwen2.5-0.5B    18ms TTFT   degenerates
 * 108ms is still inside the threshold where a suggestion feels immediate.
 */
const MODEL_CANDIDATES = [
  'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'
]

// Prompts are short (a few hundred characters of preceding text), so a small
// context keeps allocation cheap and load fast.
const CONTEXT_SIZE = 2048

// Every character here is prefill time, and prefill is the whole latency budget.
// Feeding the full field text (~800 chars with facts) cost ~200ms per call versus
// ~30ms for a short prompt, so the local model gets only the immediate tail — the
// cloud is the one that gets the full context.
const MAX_PROMPT_CHARS = 160

// Facts are only worth their prefill cost when the text is actually about the
// user; otherwise they're ~50 wasted tokens on every keystroke.
const SELF_REFERENTIAL = /\b(i|i'm|im|my|me|mine|myself|we|our)\b[^.!?]{0,40}$/i

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'

let status: Status = 'idle'
let statusDetail = ''
let llama: any = null
let model: any = null
let context: any = null
let LlamaCompletionCtor: any = null
let inFlight = false

export function localStatus(): { status: Status; detail: string } {
  return { status, detail: statusDetail }
}

export function isLocalReady(): boolean {
  return status === 'ready'
}

function modelPath(): string | null {
  // In dev, __dirname is out/main so the repo root is two levels up. Packaged
  // builds ship it under resources/. Users can also drop one in userData/models.
  const dirs = [
    join(app.getPath('userData'), 'models'),
    join(__dirname, '..', '..', 'models'),
    join(app.getAppPath(), '..', '..', 'models'),
    join(process.resourcesPath ?? '', 'models'),
    join(app.getAppPath(), 'models')
  ]
  for (const file of MODEL_CANDIDATES) {
    for (const dir of dirs) {
      const p = join(dir, file)
      if (existsSync(p)) return p
    }
  }
  log('local model: none of [' + MODEL_CANDIDATES.join(', ') + '] found in\n  ' + dirs.join('\n  '))
  return null
}

/**
 * Load the model in the background. Never throws — if anything fails we simply
 * stay on the cloud path.
 */
export async function initLocalModel(): Promise<boolean> {
  if (status === 'ready') return true
  if (status === 'loading') return false

  const path = modelPath()
  if (!path) {
    status = 'unavailable'
    statusDetail = 'no local model file found'
    return false
  }

  status = 'loading'
  statusDetail = 'loading'
  const t0 = Date.now()

  try {
    // node-llama-cpp is ESM-only ("type": "module", no require condition), so it
    // must be loaded with a dynamic import. Rollup preserves import() in CJS
    // output (dynamicImportInCjs), which is verified by scripts/esm-import-check.
    const mod = await import('node-llama-cpp')
    LlamaCompletionCtor = mod.LlamaCompletion

    // build: 'never' so a missing/incompatible prebuilt fails fast instead of
    // silently trying to compile llama.cpp from source (which needs a toolchain).
    llama = await mod.getLlama({ gpu: 'vulkan', build: 'never' })
    log(`local model: llama ready (gpu=${llama.gpu}) in ${Date.now() - t0}ms`)

    const name = basename(path)
    model = await llama.loadModel({ modelPath: path, gpuLayers: 99 })
    log(`local model: loaded ${name} layersOnGpu=${model.gpuLayers} in ${Date.now() - t0}ms`)

    context = await model.createContext({ contextSize: CONTEXT_SIZE, batchSize: 512 })

    status = 'ready'
    statusDetail = `${name.replace(/-Q4_K_M\.gguf$/, '')} · ${llama.gpu} · ${model.gpuLayers} layers`
    log(`local model: READY in ${Date.now() - t0}ms (${statusDetail})`)
    return true
  } catch (e) {
    status = 'unavailable'
    statusDetail = e instanceof Error ? e.message : String(e)
    log('local model UNAVAILABLE:', statusDetail)
    llama = model = context = null
    return false
  }
}

/**
 * Trim the model's raw continuation into something showable as ghost text.
 * Small models like to add quotes, run on past a sentence, or start a new line.
 */
function cleanCompletion(raw: string): string {
  let s = raw.replace(/\r/g, '')

  // Cut at a hard boundary
  const nl = s.indexOf('\n')
  if (nl >= 0) s = s.slice(0, nl)

  s = s.trim()

  // Strip a wrapping quote pair the model added on its own
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  // Or just a stray leading quote
  s = s.replace(/^["'`]+/, '')

  // Keep it to a phrase — anything past the first sentence end is noise
  const sentenceEnd = s.search(/[.!?](\s|$)/)
  if (sentenceEnd > 0) s = s.slice(0, sentenceEnd + 1)

  // Hard cap on words so ghost text can't sprawl
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length > 9) s = words.slice(0, 9).join(' ')

  return s.trim()
}

/**
 * Is this completion too poor to show?
 *
 * A 1.5B model fails in recognisable ways, and showing the failures for ~800ms
 * before the cloud corrects them is worse than showing nothing.
 */
function isGarbage(s: string, facts: string): boolean {
  if (!s) return true

  const words = s.split(/\s+/).filter(Boolean)

  // "i v e i n a h a d" — degenerate character-by-character output
  const singles = words.filter(w => w.length === 1 && /[a-z]/i.test(w)).length
  if (words.length >= 4 && singles / words.length > 0.5) return true

  // Parroting the facts block back instead of continuing the sentence
  if (facts) {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const f = norm(facts)
    const c = norm(s)
    if (c.length > 12 && f.includes(c)) return true
  }

  // A lone number or punctuation fragment is never a useful suggestion
  if (/^[\d\W]+$/.test(s)) return true

  return false
}

/**
 * Predict the continuation of `text`. Returns '' when nothing usable came back.
 * `facts` is prepended so self-referential text ("my name is") resolves correctly;
 * the prefix stays in the KV cache, so it costs ~76ms rather than ~555ms after the
 * first call.
 */
export async function completeLocal(
  text: string,
  facts = '',
  onPartial?: (soFar: string) => void
): Promise<string> {
  if (status !== 'ready' || !context || !LlamaCompletionCtor) return ''

  // One at a time. Without this, a fast typist queues several ~200ms GPU calls
  // that serialise, so the visible latency becomes the sum rather than the max.
  if (inFlight) return ''
  inFlight = true

  const tail = text.length > MAX_PROMPT_CHARS ? text.slice(-MAX_PROMPT_CHARS) : text
  const needsFacts = facts.trim() !== '' && SELF_REFERENTIAL.test(tail)
  const prompt = needsFacts ? `${facts.trim()}\n\n${tail}` : tail

  let sequence: any = null
  try {
    sequence = context.getSequence()
    const completion = new LlamaCompletionCtor({ contextSequence: sequence })
    // Stream it. First token lands in ~30ms but the full 10 tokens take ~130ms, so
    // waiting for completion throws away three quarters of the speed advantage.
    let acc = ''
    const raw: string = await completion.generateCompletion(prompt, {
      maxTokens: 10,
      temperature: 0.15,
      topP: 0.9,
      customStopTriggers: ['\n'],
      onTextChunk: onPartial
        ? (chunk: string) => {
            acc += chunk
            const partial = cleanCompletion(acc)
            if (partial && !isGarbage(partial, needsFacts ? facts : '')) onPartial(partial)
          }
        : undefined
    })
    const final = cleanCompletion(raw ?? acc)
    if (isGarbage(final, needsFacts ? facts : '')) {
      log(`local rejected as garbage: ${JSON.stringify(final)}`)
      return ''
    }
    return final
  } catch (e) {
    log('local completion failed:', e instanceof Error ? e.message : String(e))
    return ''
  } finally {
    // Fresh sequence per call — see note 2 at the top of this file.
    try { sequence?.dispose() } catch { /* ignore */ }
    inFlight = false
  }
}

/**
 * Run one throwaway completion so the facts prefix lands in the KV cache. Without
 * this the user's first real prediction pays ~555ms instead of ~76ms.
 */
export async function warmLocal(facts: string): Promise<void> {
  if (status !== 'ready') return
  const t0 = Date.now()
  // Warm BOTH shapes. The first real call previously took 8.8s because warming
  // with a 3-character prompt never exercised the with-facts path or a
  // realistic batch size, so the GPU pipeline for that shape was still cold.
  await completeLocal('my name is', facts)                       // with facts
  await completeLocal('the meeting has been scheduled for the')  // without
  log(`local model: warmed in ${Date.now() - t0}ms`)
}

export async function disposeLocalModel(): Promise<void> {
  try { await context?.dispose() } catch { /* ignore */ }
  try { await model?.dispose() } catch { /* ignore */ }
  try { await llama?.dispose() } catch { /* ignore */ }
  llama = model = context = null
  status = 'idle'
}
