/** Web Audio API chime synthesis for session notifications. */

let audioCtx: AudioContext | null = null

function resolveAudioContextClass(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext
  if (typeof window !== 'undefined') {
    return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  }
  return undefined
}

function ensureAudioContext(): AudioContext | undefined {
  const AudioCtxClass = resolveAudioContextClass()
  if (!AudioCtxClass) return undefined
  audioCtx ??= new AudioCtxClass()
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
  return audioCtx
}

/**
 * Create and resume the AudioContext during a real user gesture so autoplay
 * policy cannot silence later completion chimes fired while the window is
 * blurred. Call once at client bootstrap.
 */
export function primeCompletionAudio(): void {
  if (typeof window === 'undefined') return
  const prime = (): void => { ensureAudioContext() }
  window.addEventListener('pointerdown', prime, { passive: true })
  window.addEventListener('keydown', prime, { passive: true })
}

/**
 * Play a clear double-chime notification sound.
 * Gracefully no-ops in environments without AudioContext (e.g. headless/unit tests).
 */
export function playCompletionSound(): void {
  try {
    const audio = ensureAudioContext()
    if (!audio) return

    const now = audio.currentTime

    // Two-tone rising chime (note 1: F5 698.46Hz, note 2: A5 880Hz).
    // Peak gain 0.5: pure sine tones need real level to be audible on
    // laptop speakers; anything below ~0.3 reads as silence.
    const tones = [
      { freq: 698.46, start: now, duration: 0.22 },
      { freq: 880, start: now + 0.14, duration: 0.34 },
    ]

    for (const tone of tones) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(tone.freq, tone.start)

      gain.gain.setValueAtTime(0.0001, tone.start)
      gain.gain.exponentialRampToValueAtTime(0.5, tone.start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, tone.start + tone.duration)

      osc.connect(gain)
      gain.connect(audio.destination)

      osc.start(tone.start)
      osc.stop(tone.start + tone.duration)
    }
  } catch {
    // Audio playback error or autoplay policy rejection ignored
  }
}
