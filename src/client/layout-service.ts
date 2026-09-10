import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/**
 * Desktop-owned layout face for advanced mode: the frame keeps its own column
 * geometry while main-panel selection still flows through the upstream
 * controller that owns the `panelInfo` root hook.
 */
export class DesktopLayoutController implements ILayout {
  private readonly state: DesktopLayoutState
  private readonly hasPanel: ((id: string) => boolean) | undefined
  private navigation: AbortController | undefined

  /**
   * Advanced mode disables the upstream ui-layout plugin, so this controller
   * owns panel selection as well as column geometry.
   * @param state - desktop-owned column state driven by this controller.
   * @param hasPanel - registration guard over live `main` entries.
   */
  constructor(state: DesktopLayoutState, hasPanel?: (id: string) => boolean) {
    this.state = state
    this.hasPanel = hasPanel
  }

  /** @param panelId - registered main key, or null to show the Conversation. */
  selectPanel(panelId: MainPanelId | null): void {
    this.state.selectPanel(panelId, this.hasPanel)
  }

  /** @returns a signal aborted by the next navigation or layout disposal. */
  beginNavigation(): AbortSignal {
    this.navigation?.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.state.toggleSidebar()
  }

  /**
   * Report the right panel's presentation without changing its expanded state.
   * @param track - whether the panel reserves a grid track.
   * @param fullscreen - whether the panel covers the frame.
   */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.state.openRightbar(track, fullscreen)
  }

  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void {
    this.state.closeRightbar()
  }
}

/**
 * Provide the advanced layout service for one plugin-fiber lifetime.
 * @param ctx - active browser Cordis context.
 * @param controller - desktop-owned layout implementation.
 * @returns disposer for the service registration.
 */
export function provideDesktopLayout(ctx: ClientContext, controller: DesktopLayoutController): () => void {
  const dispose = ctx.reflect.provide('layout', controller)
  return () => { void dispose() }
}
