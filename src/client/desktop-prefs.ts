/** Desktop client preference persistence, host-owned.
 *
 * Renderer localStorage is origin-scoped and the kernel web server port
 * changes between launches, so any preference kept in localStorage is wiped
 * on the next start. Preferences live in one host-side JSON file served over
 * a desktop route instead; this module hydrates the client stores at boot and
 * writes changes back (debounced).
 */

import { getNotificationSettingsStore, DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from './notifications.ts'
import { getVisionFallbackStore, type VisionFallbackSettings } from './vision-models-state.ts'

const PREFS_URL = '/api/desktop/prefs'

interface PrefsFile {
  vision?: Partial<VisionFallbackSettings>
  notifications?: Partial<NotificationSettings>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving = false

function readStoredPrefs(): PrefsFile {
  try {
    const raw = localStorage.getItem('harnessx.desktop.prefs')
    if (raw !== null) return JSON.parse(raw) as PrefsFile
  } catch {
    // Cache read is best-effort; the host file is the source of truth.
  }
  return {}
}

function cachePrefs(prefs: PrefsFile): void {
  try {
    localStorage.setItem('harnessx.desktop.prefs', JSON.stringify(prefs))
  } catch {
    // Storage unavailable; the host copy still persists across restarts.
  }
}

async function fetchPrefs(): Promise<PrefsFile | undefined> {
  try {
    const response = await fetch(PREFS_URL)
    if (!response.ok) return undefined
    return await response.json() as PrefsFile
  } catch {
    return undefined
  }
}

/**
 * Pull host-side preferences into the client stores. The host file wins when
 * present; otherwise the current origin's localStorage cache seeds the stores
 * (first run after this migration keeps whatever this origin still holds).
 * @returns nothing; stores update in place.
 */
export async function hydrateDesktopPrefs(): Promise<void> {
  const hosted = await fetchPrefs()
  const prefs = hosted ?? readStoredPrefs()
  cachePrefs(prefs)
  const vision = prefs.vision
  if (vision !== undefined) {
    getVisionFallbackStore().set({
      enabled: vision.enabled === true,
      provider: typeof vision.provider === 'string' && vision.provider.length > 0 ? vision.provider : undefined,
      model: typeof vision.model === 'string' && vision.model.length > 0 ? vision.model : undefined,
    })
  }
  const notifications = prefs.notifications
  if (notifications !== undefined) {
    getNotificationSettingsStore().set({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...getNotificationSettingsStore().getSnapshot(),
      ...(typeof notifications.sound === 'boolean' ? { sound: notifications.sound } : {}),
      ...(typeof notifications.systemNotification === 'boolean' ? { systemNotification: notifications.systemNotification } : {}),
      ...(typeof notifications.onlyWhenBlurred === 'boolean' ? { onlyWhenBlurred: notifications.onlyWhenBlurred } : {}),
    })
  }
}

/**
 * Persist both stores to the host file. Calls coalesce into one request.
 */
export function schedulePersistDesktopPrefs(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    if (saving) return
    saving = true
    const body = JSON.stringify({
      vision: getVisionFallbackStore().getSnapshot(),
      notifications: getNotificationSettingsStore().getSnapshot(),
    })
    cachePrefs({ vision: getVisionFallbackStore().getSnapshot(), notifications: getNotificationSettingsStore().getSnapshot() })
    void fetch(PREFS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      // The host copy stays stale until the next change; values still serve
      // this session from the in-memory stores.
    }).finally(() => { saving = false })
  }, 300)
}
