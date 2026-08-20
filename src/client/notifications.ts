/** Session completion notification and audio preference management. */

import { playCompletionSound } from './sound.ts'

export interface NotificationSettings {
  /** Play sound when turn completes. Default: true. */
  sound: boolean
  /** Show system desktop notification when turn completes. Default: true. */
  systemNotification: boolean
  /** Only notify/play sound when the window is in background / blurred. Default: true. */
  onlyWhenBlurred: boolean
}

export const NOTIFICATION_SETTINGS_STORAGE_KEY = 'harnessx.desktop.notifications'

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  sound: true,
  systemNotification: true,
  onlyWhenBlurred: true,
}

export interface NotificationSettingsStore {
  getSnapshot(): NotificationSettings
  subscribe(listener: () => void): () => void
  update(mutator: (draft: NotificationSettings) => void): void
  set(next: NotificationSettings): void
}

let settingsStore: NotificationSettingsStore | null = null

function readPersistedSettings(): NotificationSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_NOTIFICATION_SETTINGS
  try {
    const raw = localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY)
    if (raw !== null) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) }
    }
  } catch {
    // Storage unavailable or JSON parse error
  }
  return DEFAULT_NOTIFICATION_SETTINGS
}

function writePersistedSettings(settings: NotificationSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable
  }
}

export function getNotificationSettingsStore(): NotificationSettingsStore {
  if (!settingsStore) {
    let current = readPersistedSettings()
    const listeners = new Set<() => void>()

    settingsStore = {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      update: (mutator) => {
        const next = { ...current }
        mutator(next)
        current = Object.freeze(next)
        writePersistedSettings(current)
        for (const listener of listeners) listener()
      },
      set: (next) => {
        current = Object.freeze({ ...next })
        writePersistedSettings(current)
        for (const listener of listeners) listener()
      },
    }
  }
  return settingsStore
}

/** Check if current window / document is blurred or hidden. */
export function isWindowUnfocused(): boolean {
  if (typeof document === 'undefined') return false
  return document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())
}

/** Request notification permission if needed (Electron permits by default). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const perm = await Notification.requestPermission()
    return perm === 'granted'
  } catch {
    return false
  }
}

export interface NotifyCompletionOptions {
  sessionId: string
  title: string
  error?: boolean
}

/** Trigger sound and/or OS notification for completed session turn. */
export function notifySessionCompleted(opts: NotifyCompletionOptions): void {
  const settings = getNotificationSettingsStore().getSnapshot()
  const unfocused = isWindowUnfocused()

  if (settings.onlyWhenBlurred && !unfocused) {
    return
  }

  if (settings.sound) {
    playCompletionSound()
  }

  if (settings.systemNotification && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      try {
        const bodyText = opts.error
          ? (opts.title ? `“${opts.title}” 发生错误` : '任务执行出错')
          : (opts.title ? `“${opts.title}” 已完成` : '任务已完成')

        const notification = new Notification('DeepSeek HarnessX', {
          body: bodyText,
          tag: `session-complete-${opts.sessionId}`,
        })
        notification.onclick = () => {
          window.focus?.()
          notification.close()
        }
      } catch {
        // Notification creation error ignored
      }
    } else if (Notification.permission !== 'denied') {
      void requestNotificationPermission().then((granted) => {
        if (granted) {
          notifySessionCompleted(opts)
        }
      })
    }
  }
}
