/**
 * Desktop additions layered additively over the unmodified kernel UI.
 *
 * Advanced mode keeps the upstream ui-layout/AppFrame composition: the
 * kernel's interface renders exactly as it does standalone. The desktop
 * contributes only additive surfaces — the workbench dock through the
 * documented `shell.overlay` list slot, the product name through the
 * sidebar's brand seat, and its settings sections.
 */

import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { installAdvancedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'
import { setWorkbenchApiClient, WorkbenchOverlayEntry, type WorkbenchWireApi } from './workbench.tsx'

/** Product name occupying the sidebar's documented brand-name seat. */
export function DesktopBrandName(): ReactNode {
  return 'HARNESSX'
}

/**
 * Layer desktop-owned surfaces over the running kernel UI.
 * @param ctx - active browser Cordis context.
 * @param environment - validated mode and platform marker.
 */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  if (environment.mode !== 'advanced') {
    throw new Error(`harnessx-desktop: advanced shell received mode ${JSON.stringify(environment.mode)}`)
  }

  // The dock's auxiliary chat drives real sessions through the shared API
  // client; capture it once the connection service is available.
  const connection = ctx.get('connection') as { api?: WorkbenchWireApi }
  setWorkbenchApiClient(connection?.api)

  ctx.effect(() => {
    document.body.dataset.dshDesktopMode = 'advanced'
    document.body.dataset.dshDesktopPlatform = environment.platform
    const removeStyles = installAdvancedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => {
    const presenter = new DesktopThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop: theme presenter')

  // The workbench dock rides the kernel's additive overlay slot: the kernel
  // frame and layout stay untouched while the dock floats at the right edge.
  ctx.effect(() => ctx.slots.register({
    name: 'shell.overlay',
    id: 'harnessx-workbench',
  }, WorkbenchOverlayEntry), 'desktop: workbench overlay')

  // Occupy the sidebar's documented brand-name seat with the product name.
  // Slot shadowing (priority below the official brand plugin's default 0) is
  // the sanctioned composition path, so kernel updates cannot regress it.
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -1,
  }, DesktopBrandName)), 'desktop: product brand name')
}
