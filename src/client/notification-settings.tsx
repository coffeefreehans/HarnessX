/** Standalone "Notifications" settings section, owned entirely by the desktop client.
 *
 * Registers as its own `settings.section` page (the kernel's sanctioned
 * extension point for feature-owned settings pages) instead of a row inside
 * the kernel's General section, so kernel snapshot updates cannot move,
 * restyle, or drop the surface. The values themselves live in
 * localStorage under the desktop-owned key in notifications.ts.
 */

import { useState, useEffect } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  getNotificationSettingsStore,
  requestNotificationPermission,
  type NotificationSettings,
} from './notifications.ts'
import { playCompletionSound } from './sound.ts'
import { DESKTOP_NAV_ICONS, registerDesktopSettingsNavSection } from './desktop-section.tsx'


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.notification': NotificationSettingsKey
  }
}

export type NotificationSettingsKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'sound'
  | 'soundDesc'
  | 'testSound'
  | 'system'
  | 'systemDesc'
  | 'onlyWhenBlurred'
  | 'onlyWhenBlurredDesc'

const zh: Record<NotificationSettingsKey, string> = {
  nav: '通知',
  title: '通知',
  desc: '设置会话或任务执行完成时的声音与系统通知提示。',
  sound: '提示音',
  soundDesc: '任务完成或等待批准时播放提示音',
  testSound: '试听',
  system: '系统通知',
  systemDesc: '任务完成或等待批准时发送系统桌面通知，点击可跳转到会话',
  onlyWhenBlurred: '仅在后台时提醒',
  onlyWhenBlurredDesc: '仅当应用窗口处于后台或失去焦点时触发通知与声音',
}

const en: Record<NotificationSettingsKey, string> = {
  nav: 'Notifications',
  title: 'Notifications',
  desc: 'Configure sound and system notifications when a session or turn completes.',
  sound: 'Sound Alert',
  soundDesc: 'Play a chime on completion or when approval is needed',
  testSound: 'Test Sound',
  system: 'System Notification',
  systemDesc: 'Desktop notification on completion or when approval is needed; click jumps to the session',
  onlyWhenBlurred: 'Only in Background',
  onlyWhenBlurredDesc: 'Only trigger sound and notifications when window is in background or unfocused',
}

const NS = 'settings.notification'

const NOTIFICATION_CSS = `
.dshNotificationSection { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 24px; max-width: 640px; }
.dshNotificationHeader { display: flex; flex-direction: column; gap: 4px; }
.dshNotificationTitle { font-size: 16px; font-weight: 600; line-height: 24px; color: var(--dsw-alias-label-primary); }
.dshNotificationDesc { font-size: 12px; font-weight: 400; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshNotificationOptions { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.dshNotificationItem { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); }
.dshNotificationItemLeft { display: flex; flex-direction: column; gap: 2px; }
.dshNotificationItemLabel { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshNotificationItemDesc { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dshNotificationItemRight { display: flex; align-items: center; gap: 10px; }
.dshNotificationToggle { appearance: none; width: 36px; height: 20px; border-radius: 10px; background: var(--dsw-alias-border-l2, #ccc); position: relative; cursor: pointer; outline: none; transition: background 0.2s ease; margin: 0; }
.dshNotificationToggle:checked { background: var(--dsw-alias-accent, #2563eb); }
.dshNotificationToggle::before { content: ""; position: absolute; width: 16px; height: 16px; border-radius: 50%; top: 2px; left: 2px; background: #fff; transition: transform 0.2s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
.dshNotificationToggle:checked::before { transform: translateX(16px); }
.dshNotificationTestButton { padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; }
.dshNotificationTestButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
`

let stylesInjected = false
function ensureNotificationStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/notification-settings'
  style.textContent = NOTIFICATION_CSS
  document.head.appendChild(style)
  stylesInjected = true
}

export function NotificationSettingsSection(_props: PropsRuntime<'settings.section'> & PropsLocale<'settings.notification'>) {
  const { t } = _props
  const store = getNotificationSettingsStore()
  const [settings, setSettings] = useState<NotificationSettings>(store.getSnapshot())

  useEffect(() => {
    ensureNotificationStyles()
    return store.subscribe(() => {
      setSettings(store.getSnapshot())
    })
  }, [store])

  const update = (patch: Partial<NotificationSettings>) => {
    store.update((draft) => {
      Object.assign(draft, patch)
    })
    if (patch.systemNotification) {
      void requestNotificationPermission()
    }
  }

  return (
    <div className="dshNotificationSection">
      <div className="dshNotificationHeader">
        <div className="dshNotificationTitle">{t('title')}</div>
        <div className="dshNotificationDesc">{t('desc')}</div>
      </div>

      <div className="dshNotificationOptions">
        <div className="dshNotificationItem">
          <div className="dshNotificationItemLeft">
            <div className="dshNotificationItemLabel">{t('sound')}</div>
            <div className="dshNotificationItemDesc">{t('soundDesc')}</div>
          </div>
          <div className="dshNotificationItemRight">
            <button
              type="button"
              className="dshNotificationTestButton"
              onClick={() => { playCompletionSound() }}
            >
              {t('testSound')}
            </button>
            <input
              type="checkbox"
              className="dshNotificationToggle"
              aria-label={t('sound')}
              checked={settings.sound}
              onChange={e => update({ sound: e.target.checked })}
            />
          </div>
        </div>

        <div className="dshNotificationItem">
          <div className="dshNotificationItemLeft">
            <div className="dshNotificationItemLabel">{t('system')}</div>
            <div className="dshNotificationItemDesc">{t('systemDesc')}</div>
          </div>
          <div className="dshNotificationItemRight">
            <input
              type="checkbox"
              className="dshNotificationToggle"
              aria-label={t('system')}
              checked={settings.systemNotification}
              onChange={e => update({ systemNotification: e.target.checked })}
            />
          </div>
        </div>

        <div className="dshNotificationItem">
          <div className="dshNotificationItemLeft">
            <div className="dshNotificationItemLabel">{t('onlyWhenBlurred')}</div>
            <div className="dshNotificationItemDesc">{t('onlyWhenBlurredDesc')}</div>
          </div>
          <div className="dshNotificationItemRight">
            <input
              type="checkbox"
              className="dshNotificationToggle"
              aria-label={t('onlyWhenBlurred')}
              checked={settings.onlyWhenBlurred}
              onChange={e => update({ onlyWhenBlurred: e.target.checked })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Register the desktop-owned Notifications section in the settings panel. */
export function applyNotificationSettings(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'notifications: dictionaries')
  const t = ctx.locale.bind(NS)
  registerDesktopSettingsNavSection(() => t('nav'), DESKTOP_NAV_ICONS.bell)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'notifications',
    order: 80,
    label: () => t('nav'),
    locale: NS,
  }, NotificationSettingsSection))
}
