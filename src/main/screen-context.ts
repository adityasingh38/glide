import { desktopCapturer } from 'electron'
import { log } from './log'

/**
 * Screenshot context for predictions.
 *
 * Two constraints shape this:
 *
 *  1. `desktopCapturer` is main-process-only since Electron 17. The previous
 *     implementation called it from a preload (a renderer context) where it is
 *     `undefined`, inside a try/catch that resolved null — so screen context was
 *     a silent no-op that never captured a frame.
 *
 *  2. `getSources` costs ~780ms warm (and several seconds cold). Inline
 *     autocomplete budgets ~280ms end to end, so a capture can NEVER block a
 *     prediction. Instead we serve a cached frame and refresh in the background.
 *
 * Net effect: the first prediction after switching apps may go without an image,
 * every one after it has a fresh-enough frame.
 */

// A screen doesn't meaningfully change for prediction purposes in a few seconds,
// and re-capturing per keystroke would burn ~2.7k vision tokens a pop.
const STALE_AFTER_MS = 20_000

// JPEG over PNG: 202KB vs 425KB at 1080p for the same usable detail.
const JPEG_QUALITY = 72

// Enough resolution that on-screen text stays legible, but no more: 1600x900 cost
// ~240ms more time-to-first-token than 1024x576 for identical predictions, so this
// sits in between.
const CAPTURE = { width: 1280, height: 720 }

interface Frame {
  b64: string
  at: number
  windowId: string
}

let frame: Frame | null = null
let inFlight = false

/**
 * A recent screenshot for this window, or null if we don't have one yet.
 * Never blocks — callers get whatever is already cached.
 */
export function getScreenFrame(windowId: string): string | null {
  if (!frame) return null
  if (frame.windowId !== windowId) return null
  if (Date.now() - frame.at > STALE_AFTER_MS) return null
  return frame.b64
}

/**
 * Kick off a background capture. Safe to call often — it self-throttles and
 * never rejects.
 */
export function refreshScreenFrame(windowId: string): void {
  if (inFlight) return
  const fresh = frame && frame.windowId === windowId && Date.now() - frame.at < STALE_AFTER_MS
  if (fresh) return

  inFlight = true
  const t0 = Date.now()
  desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: CAPTURE })
    .then((sources) => {
      const thumb = sources[0]?.thumbnail
      if (!thumb || thumb.isEmpty()) {
        log('screen capture: empty thumbnail')
        return
      }
      const b64 = thumb.toJPEG(JPEG_QUALITY).toString('base64')
      frame = { b64, at: Date.now(), windowId }
      log(`screen captured ${Math.round(b64.length / 1024)}KB in ${Date.now() - t0}ms`)
    })
    .catch((e: unknown) => {
      log('screen capture FAILED:', e instanceof Error ? e.message : String(e))
    })
    .finally(() => { inFlight = false })
}

export function clearScreenFrame(): void {
  frame = null
}
