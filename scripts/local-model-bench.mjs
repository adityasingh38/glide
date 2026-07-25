/**
 * Can a local model beat the cloud's ~850ms time-to-first-token?
 *
 * Cotypist is instant because it runs on-device. Our cloud floor is ~850ms
 * (~200ms network + ~600ms Haiku TTFT), so this measures whether a small model on
 * the GTX 1650 Ti gets us into the sub-150ms range that actually feels instant.
 *
 * Measures TTFT specifically, not total generation — that's the felt latency.
 *
 * Run: node scripts/local-model-bench.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getLlama, LlamaChatSession, LlamaCompletion } from 'node-llama-cpp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODEL = join(
  __dirname, '..', 'models',
  process.argv[3] ?? 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'
)

// Personal facts, prefixed so the model can answer self-referential text. At GPU
// speed the extra prefill is affordable — the whole point of the latency headroom.
const FACTS = `About me: My name is Aditya Singh. I live in Ahmedabad, India. I work at CultureX Entertainment as the Founder's Office Executive. I build Windows and React Native apps.\n\n`

// Same shapes the app actually sees
const CASES = [
  'my name is',
  'it is raining in',
  'the meeting is scheduled for',
  'i am working on a project called',
  'function getUserById'
]

const SYSTEM = `You are a text autocomplete engine. Continue the user's text with the next 2-8 words only.
Output only the continuation. No quotes, no explanation. Never refuse.
Do not repeat words already present. Do not start with a space.`

function ms(t0) { return Number(process.hrtime.bigint() - t0) / 1e6 }

// CUDA's prebuilt binary is incompatible here (no CUDA Toolkit runtime installed)
// and building from source would need VS Build Tools + CUDA Toolkit. Vulkan ships
// a working prebuilt and runs on the GTX 1650 Ti straight from the driver, so try
// that first, then fall back to CPU.
const BACKEND = process.argv[2] ?? 'vulkan'

async function main() {
  console.log(`loading llama (backend: ${BACKEND})…`)
  let t0 = process.hrtime.bigint()
  const llama = await getLlama(
    BACKEND === 'cpu'
      ? { gpu: false, build: 'never' }
      : { gpu: BACKEND, build: 'never' }
  )
  console.log(`  getLlama: ${ms(t0).toFixed(0)}ms  gpu=${llama.gpu}`)
  const vram = llama.getVramState()
  console.log(`  vram: ${(vram.total / 1024 ** 3).toFixed(1)}GB total, ${(vram.free / 1024 ** 3).toFixed(1)}GB free`)

  t0 = process.hrtime.bigint()
  const model = await llama.loadModel(
    BACKEND === 'cpu' ? { modelPath: MODEL } : { modelPath: MODEL, gpuLayers: 99 }
  )
  console.log(`  loadModel: ${ms(t0).toFixed(0)}ms  layersOnGpu=${model.gpuLayers}`)

  t0 = process.hrtime.bigint()
  const context = await model.createContext({ contextSize: 1024, batchSize: 512 })
  console.log(`  createContext: ${ms(t0).toFixed(0)}ms`)
  console.log(`  vram free after load: ${(llama.getVramState().free / 1024 ** 3).toFixed(2)}GB\n`)

  // Raw completion, not chat. A chat wrapper made the model echo the input
  // ("my name is John Doe" instead of "John Doe") and add quotes, and it costs
  // extra prefill tokens. Raw continuation is what a text predictor actually wants.
  //
  // A FRESH sequence per completion: reusing one made TTFT swing between 17ms and
  // 1241ms for identically-sized prompts, because the KV cache filled up and
  // forced context shifts that re-evaluated everything.
  async function complete(text, maxTokens = 12) {
    const seq = context.getSequence()
    try {
      const completion = new LlamaCompletion({ contextSequence: seq })
      let first = null
      const start = process.hrtime.bigint()
      const out = await completion.generateCompletion(text, {
        maxTokens,
        temperature: 0.15,
        customStopTriggers: ['\n'],
        onTextChunk() { if (first === null) first = ms(start) }
      })
      return { out, first: first ?? -1, total: ms(start) }
    } finally {
      seq.dispose()
    }
  }

  // Warm-up so we measure steady state, not first-call overhead
  await complete('warm up the', 4)

  console.log('TTFT = ms to FIRST token (what the user feels), 3 runs each\n')
  const allTtfts = []

  for (const text of CASES) {
    const runs = []
    let sample = ''
    for (let i = 0; i < 3; i++) {
      const r = await complete(text)
      runs.push(Math.round(r.first))
      sample = r.out
    }
    runs.sort((a, b) => a - b)
    const med = runs[1]
    allTtfts.push(med)
    console.log(`  ${JSON.stringify(text).padEnd(36)} TTFT ${String(med).padStart(4)}ms  runs=[${runs.join(',')}]`)
    console.log(`  ${' '.repeat(36)} -> ${JSON.stringify(sample.trim().slice(0, 60))}`)
  }

  // Does prefixing personal facts still stay instant, and does it fix "my name is"?
  console.log('\n  --- with personal facts prefixed ---')
  for (const text of ['my name is', 'i live in', 'i work at']) {
    const r = await complete(FACTS + text)
    console.log(`  ${JSON.stringify(text).padEnd(36)} TTFT ${String(Math.round(r.first)).padStart(4)}ms`)
    console.log(`  ${' '.repeat(36)} -> ${JSON.stringify(r.out.trim().slice(0, 60))}`)
  }

  const sorted = [...allTtfts].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`\n  median TTFT: ${Math.round(median)}ms`)
  console.log(`  cloud baseline (haiku + cached screenshot): 847ms`)
  console.log(`  speedup: ${(847 / median).toFixed(1)}x`)

  await context.dispose()
  await model.dispose()
  await llama.dispose()
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
