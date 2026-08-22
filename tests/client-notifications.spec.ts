import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  getNotificationSettingsStore,
  notifySessionCompleted,
  isWindowUnfocused,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '../src/client/notifications.ts'
import { playCompletionSound } from '../src/client/sound.ts'
import { applySessionNotifications } from '../src/client/session-notifications.ts'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

describe('client notifications and sound', () => {
  beforeEach(() => {
    const store = getNotificationSettingsStore()
    store.set({ ...DEFAULT_NOTIFICATION_SETTINGS })
  })

  it('plays completion sound cleanly when sound is enabled', () => {
    const createOscillator = vi.fn(() => ({
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }))
    const createGain = vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }))

    const AudioContextMock = vi.fn(function () {
      return {
        state: 'running',
        currentTime: 10,
        destination: {},
        createOscillator,
        createGain,
        resume: vi.fn(),
      }
    })

    vi.stubGlobal('AudioContext', AudioContextMock)

    try {
      playCompletionSound()
      expect(createOscillator).toHaveBeenCalledTimes(2)
      expect(createGain).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('notifies when window is unfocused or onlyWhenBlurred is disabled', () => {
    const notificationConstructor = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
      return {
        title,
        options,
        close: vi.fn(),
      }
    })

    vi.stubGlobal('Notification', Object.assign(notificationConstructor, {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    }))

    vi.stubGlobal('document', {
      hidden: true,
      hasFocus: () => false,
    })

    try {
      expect(isWindowUnfocused()).toBe(true)

      const onOpen = vi.fn()
      notifySessionCompleted({
        sessionId: 'test-session-1' as SessionId,
        title: 'Fix Bug',
        workspace: 'HernessX',
        onOpen,
      })

      expect(notificationConstructor).toHaveBeenCalledWith('Fix Bug', {
        body: '任务完成 · HernessX',
        tag: 'session-complete-test-session-1',
      })

      const instance = notificationConstructor.mock.results.at(-1)?.value as { onclick?: () => void }
      instance.onclick?.()
      expect(onOpen).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('notifies with the approval body when the agent stops for the user', () => {
    const notificationConstructor = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
      return { title, options, close: vi.fn() }
    })

    vi.stubGlobal('Notification', Object.assign(notificationConstructor, {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    }))

    vi.stubGlobal('document', {
      hidden: true,
      hasFocus: () => false,
    })

    try {
      notifySessionCompleted({
        sessionId: 'test-session-9' as SessionId,
        title: 'Review plan',
        workspace: 'website',
        kind: 'approval',
      })

      expect(notificationConstructor).toHaveBeenCalledWith('Review plan', {
        body: '等待你的批准 · website',
        tag: 'session-approval-test-session-9',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('skips notification when window is focused and onlyWhenBlurred is true', () => {
    const notificationConstructor = vi.fn()

    vi.stubGlobal('Notification', Object.assign(notificationConstructor, {
      permission: 'granted',
    }))

    vi.stubGlobal('document', {
      hidden: false,
      hasFocus: () => true,
    })

    try {
      expect(isWindowUnfocused()).toBe(false)

      notifySessionCompleted({
        sessionId: 'test-session-2' as SessionId,
        title: 'Running Task',
      })

      expect(notificationConstructor).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('watches session running state transitions (true -> false) and triggers notification', () => {
    let listListener: (() => void) | undefined
    let snapshot = {
      phase: 'ready',
      ids: ['s1' as SessionId],
      byId: {
        s1: {
          id: 's1' as SessionId,
          displayTitle: 'Session 1',
          running: true,
          blank: false,
          updatedAt: Date.now(),
        },
      },
    }

    const ctx = {
      sessions: {
        list: {
          subscribe: (fn: () => void) => {
            listListener = fn
            return () => { listListener = undefined }
          },
          getSnapshot: () => snapshot,
        },
      },
      effect: (fn: () => void) => fn(),
    } as unknown as ClientContext

    const notificationConstructor = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
      return { title, options, close: vi.fn() }
    })

    vi.stubGlobal('Notification', Object.assign(notificationConstructor, {
      permission: 'granted',
    }))
    vi.stubGlobal('document', {
      hidden: true,
      hasFocus: () => false,
    })

    try {
      applySessionNotifications(ctx)

      // First tick: records running=true
      listListener?.()
      expect(notificationConstructor).not.toHaveBeenCalled()

      // Transition to running=false
      snapshot = {
        phase: 'ready',
        ids: ['s1' as SessionId],
        byId: {
          s1: {
            id: 's1' as SessionId,
            displayTitle: 'Session 1',
            running: false,
            blank: false,
            updatedAt: Date.now(),
          },
        },
      }
      listListener?.()

      expect(notificationConstructor).toHaveBeenCalledWith('Session 1', {
        body: '任务完成',
        tag: 'session-complete-s1',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
