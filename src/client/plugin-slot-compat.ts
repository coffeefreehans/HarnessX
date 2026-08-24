/** Compatibility shim for community plugins registering keyed slots without keys.
 *
 * Upstream's `settings.plugin.item` slot is keyed by the settings namespace a
 * card edits, and the kernel rejects unkeyed registrations at boot — which an
 * external bundle's mistake turns into a whole-window "Failed to load plugins"
 * report. This wrapper runs ahead of every appended community bundle and
 * completes missing keys with a stable registrant-derived one (retrying past
 * same-priority duplicates), so a broken third-party card degrades to "not
 * shown" instead of blocking the entire client boot.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const COMPAT_SLOT_NAME = 'settings.plugin.item'
const MAX_KEY_ATTEMPTS = 8

interface RegisterOptions extends Record<string, unknown> {
  name?: unknown
  key?: unknown
  registrant?: unknown
}

type ErasedRegister = (options: RegisterOptions, component: unknown) => () => void

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('already has an entry')
}

/** Derive a readable, stable fallback key from the registrant label when present. */
function fallbackKeyBase(registrant: unknown, counter: number): string {
  if (typeof registrant === 'string' && registrant.trim() !== '') {
    const sanitized = registrant.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
    if (sanitized !== '') return sanitized
  }
  return `external-${String(counter)}`
}

/**
 * Wrap slot registration so unkeyed `settings.plugin.item` entries still land.
 * @param ctx - browser Cordis context, patched before community bundles apply.
 * @returns an idempotent disposer restoring the original registration method.
 */
export function installPluginSlotCompat(ctx: ClientContext): () => void {
  const slots = ctx.slots as unknown as { register: ErasedRegister }
  const original = slots.register.bind(slots)
  let active = true
  let anonymousCounter = 0
  slots.register = (options, component) => {
    if (!active || options.name !== COMPAT_SLOT_NAME || options.key !== undefined) {
      return original(options, component)
    }
    const base = fallbackKeyBase(options.registrant, ++anonymousCounter)
    for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt++) {
      const key = attempt === 1 ? base : `${base}-${String(attempt)}`
      try {
        return original({ ...options, key }, component)
      } catch (error) {
        if (attempt === MAX_KEY_ATTEMPTS || !isDuplicateKeyError(error)) throw error
      }
    }
    throw new Error(`${COMPAT_SLOT_NAME}: unreachable retry loop exit`)
  }
  return () => {
    if (!active) return
    active = false
    slots.register = original
  }
}
