/** Cordis Host plugin contributing the packaged DSH terminal to the native tray. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-terminal'

/** Native adapter required to create shims and launch the system terminal. */
export const inject = ['desktopRuntime']

/**
 * Register the system-terminal command for one Host generation.
 * @param ctx - Host context carrying the Electron adapter.
 */
export function apply(ctx: Context): void {
  if (ctx.desktopRuntime.platform === 'linux') {
    throw new Error('harnessx-desktop: the packaged terminal is supported on macOS and Windows')
  }
  ctx.effect(() => {
    const isZh = (process.env.LANG ?? process.env.LC_ALL ?? '').toLowerCase().startsWith('zh')
      || Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')
    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 10,
      label: () => isZh ? '打开 DSH 终端' : 'Open DSH Terminal',
      invoke: () => { ctx.desktopRuntime.openTerminal() },
    })
    return () => { registration.dispose() }
  }, 'harnessx-desktop: packaged terminal tray command')
}
