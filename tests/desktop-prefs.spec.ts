import { describe, expect, it } from 'vitest'
import { mergePrefs, normalizePrefs, optionalString } from '../src/desktop-prefs.ts'

describe('normalizePrefs', () => {
  it('keeps only well-formed fields', () => {
    expect(normalizePrefs({
      vision: { enabled: true, provider: 'router', model: 'glm-5v', bogus: 1 },
      notifications: { sound: false, systemNotification: 'yes', onlyWhenBlurred: true },
    })).toEqual({
      vision: { enabled: true, provider: 'router', model: 'glm-5v' },
      notifications: { sound: false, onlyWhenBlurred: true },
    })
  })

  it('drops non-object input and sections without corrupting the rest', () => {
    expect(normalizePrefs(null)).toEqual({})
    expect(normalizePrefs('nope')).toEqual({})
    expect(normalizePrefs({ vision: 7, notifications: { sound: true } })).toEqual({
      notifications: { sound: true },
    })
  })

  it('treats empty strings as absent', () => {
    expect(normalizePrefs({ vision: { provider: '', model: 'm' } })).toEqual({
      vision: { model: 'm' },
    })
    expect(optionalString(undefined)).toBeUndefined()
    expect(optionalString('x')).toBe('x')
  })
})

describe('mergePrefs', () => {
  it('patches per field without losing untouched ones', () => {
    const base = normalizePrefs({
      vision: { enabled: true, provider: 'router', model: 'glm-5v' },
      notifications: { sound: true, onlyWhenBlurred: false },
    })
    expect(mergePrefs(base, normalizePrefs({ vision: { enabled: false } }))).toEqual({
      vision: { enabled: false, provider: 'router', model: 'glm-5v' },
      notifications: { sound: true, onlyWhenBlurred: false },
    })
  })

  it('round-trips through normalize without drift', () => {
    const prefs = normalizePrefs({ vision: { enabled: true, provider: 'router', model: 'glm-5v' } })
    expect(normalizePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs)
  })
})
