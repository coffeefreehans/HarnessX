import { describe, expect, it } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installPluginSlotCompat } from '../src/client/plugin-slot-compat.ts'

interface RecordedCall {
  options: Record<string, unknown>
  component: unknown
}

function createContext(): {
  ctx: ClientContext
  registered: RecordedCall[]
} {
  const registered: RecordedCall[] = []
  const slots = {
    register(options: Record<string, unknown>, component: unknown): () => void {
      if (options.name !== 'settings.plugin.item' && options.name !== 'settings.other.slot') {
        throw new Error(`slot "${String(options.name)}" is not declared`)
      }
      if (options.name === 'settings.plugin.item' && options.key === undefined) {
        throw new Error(`keyed slot "settings.plugin.item" requires options.key`)
      }
      const occupant = registered.find(call => call.options.name === options.name
        && call.options.key === options.key
        && (call.options.priority ?? 0) === (options.priority ?? 0))
      if (occupant !== undefined) {
        throw new Error(`keyed slot "${String(options.name)}" already has an entry for key "${String(options.key)}" at priority ${String(options.priority ?? 0)}`)
      }
      registered.push({ options: { ...options }, component })
      return () => {}
    },
  }
  return { ctx: { slots } as unknown as ClientContext, registered }
}

function registerErased(ctx: ClientContext, options: Record<string, unknown>, component: unknown): () => void {
  const slots = ctx.slots as unknown as {
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  return slots.register(options, component)
}

describe('plugin slot compat', () => {
  it('passes keyed registrations through untouched', () => {
    const { ctx, registered } = createContext()
    installPluginSlotCompat(ctx)
    registerErased(ctx, { name: 'settings.plugin.item', key: 'myNamespace' }, 'component-a')
    expect(registered).toHaveLength(1)
    expect(registered[0]?.options.key).toBe('myNamespace')
  })

  it('completes an unkeyed community card with a registrant-derived stable key', () => {
    const { ctx, registered } = createContext()
    installPluginSlotCompat(ctx)
    registerErased(ctx, {
      name: 'settings.plugin.item',
      registrant: '@linxin666/dsh-client-ui-web-ui-settings',
    }, 'community-card')
    expect(registered).toHaveLength(1)
    expect(registered[0]?.options.key).toBe('linxin666-dsh-client-ui-web-ui-settings')
    expect(registered[0]?.component).toBe('community-card')
  })

  it('falls back to anonymous keys when no registrant label exists', () => {
    const { ctx, registered } = createContext()
    installPluginSlotCompat(ctx)
    registerErased(ctx, { name: 'settings.plugin.item' }, 'first')
    registerErased(ctx, { name: 'settings.plugin.item', priority: 5 }, 'second')
    expect(registered.map(call => call.options.key)).toEqual(['external-1', 'external-2'])
  })

  it('retries past same-key collisions with a numeric suffix', () => {
    const { ctx, registered } = createContext()
    installPluginSlotCompat(ctx)
    registerErased(ctx, { name: 'settings.plugin.item', key: 'taken' }, 'existing')
    registerErased(ctx, { name: 'settings.plugin.item', registrant: 'taken' }, 'newcomer')
    expect(registered).toHaveLength(2)
    expect(registered[1]?.options.key).toBe('taken-2')
  })

  it('leaves other slots alone even when they lack a key', () => {
    const { ctx, registered } = createContext()
    installPluginSlotCompat(ctx)
    registerErased(ctx, { name: 'settings.other.slot' }, 'panel')
    expect(registered[0]?.options.key).toBeUndefined()
  })

  it('propagates unrelated registration failures', () => {
    const { ctx } = createContext()
    installPluginSlotCompat(ctx)
    expect(() => registerErased(ctx, { name: 'undeclared.slot', key: 'x' }, 'c'))
      .toThrowError(/is not declared/)
  })

  it('restores the original register on dispose', () => {
    const { ctx, registered } = createContext()
    const dispose = installPluginSlotCompat(ctx)
    dispose()
    dispose()
    expect(() => registerErased(ctx, { name: 'settings.plugin.item' }, 'late'))
      .toThrowError(/requires options\.key/)
    expect(registered).toHaveLength(0)
  })
})
