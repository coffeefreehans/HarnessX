/** Web Audio API chime synthesis for session notifications. */

let audioCtx: AudioContext | null = null

function resolveAudioContextClass(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext
  if (typeof window !== 'undefined') {
    return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  }
  return undefined
}

/**
 * Play a gentle double-chime notification sound.
 * Gracefully no-ops in environments without AudioContext (e.g. headless/unit tests).
 */
export function playCompletionSound(): void {
  try {
    const AudioCtxClass = resolveAudioContextClass()
    if (!AudioCtxClass) return

    audioCtx ??= new AudioCtxClass()
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }

    const now = audioCtx.currentTime

    // Two-tone rising chime (note 1: F5 698.46Hz, note 2: A5 880Hz)
    const tones = [
      { freq: 698.46, start: now, duration: 0.18 },
      { freq: 880, start: now + 0.12, duration: 0.28 },
    ]

    for (const tone of tones) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(tone.freq, tone.start)

      gain.gain.setValueAtTime(0.0001, tone.start)
      gain.gain.exponentialRampToValueAtTime(0.12, tone.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, tone.start + tone.duration)

      osc.connect(gain)
      gain.connect(audioCtx.destination)

      osc.start(tone.start)
      osc.stop(tone.start + tone.duration)
    }
  } catch {
    // Audio playback error or autoplay policy rejection ignored
  }
}

