import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type convergence only: locale/theme declarations expose settings slot rows.
// The desktop client does not load or register a settings surface.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyMarket } from './market.tsx'
import { applyUpdates } from './updates.tsx'
import { applySessionNotifications } from './session-notifications.ts'
import { applyNotificationSettings } from './notification-settings.tsx'
import { applyVisionModels } from './vision-models.tsx'
import { installVisionFallback } from './vision-fallback.ts'
import { hydrateDesktopPrefs } from './desktop-prefs.ts'
import { applySync } from './sync.tsx'
import { primeCompletionAudio } from './sound.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type { DesktopClientEnvironment, DesktopClientMode, DesktopClientPlatform } from './environment.ts'
export { playCompletionSound, primeCompletionAudio } from './sound.ts'
export {
  getNotificationSettingsStore,
  notifySessionCompleted,
  NOTIFICATION_SETTINGS_STORAGE_KEY,
} from './notifications.ts'
export type { NotificationSettings } from './notifications.ts'

/** Services required by advanced presentation and market/updates panels. */
export const inject = [
  'slots',
  'sessions',
  'theme',
  'locale',
  'connection',
  'remote',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  // Warm the AudioContext on the first real gesture so blurred-window
  // completion chimes are not silenced by autoplay policy.
  primeCompletionAudio()
  applyMarket(ctx)
  applyUpdates(ctx)
  applySessionNotifications(ctx)
  applyNotificationSettings(ctx)
  applyVisionModels(ctx)
  installVisionFallback(ctx)
  applySync(ctx)
  // localStorage is port-scoped and the port changes per launch; desktop
  // preferences live host-side and hydrate into the stores here.
  void hydrateDesktopPrefs()
}
