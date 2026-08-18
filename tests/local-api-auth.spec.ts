import type { IncomingHttpHeaders } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  authorizeLocalApiRequest,
  createLocalApiSession,
  LOCAL_API_COOKIE_NAME,
} from '../src/local-api-auth.ts'

function request(method: string, headers: IncomingHttpHeaders) {
  return { method, headers }
}

describe('desktop local API authorization', () => {
  it('accepts the HttpOnly session cookie on reads and requires the exact origin on writes', () => {
    const session = createLocalApiSession('http://127.0.0.1:43120')
    const cookie = `${LOCAL_API_COOKIE_NAME}=${session.token}`

    expect(authorizeLocalApiRequest(request('GET', { cookie }), session)).toBe(true)
    expect(authorizeLocalApiRequest(request('POST', {
      cookie,
      origin: session.origin,
    }), session)).toBe(true)
    expect(authorizeLocalApiRequest(request('POST', {
      cookie,
      origin: 'https://attacker.example',
    }), session)).toBe(false)
  })

  it('rejects missing, malformed, and stale session credentials', () => {
    const session = createLocalApiSession('http://127.0.0.1:43120')

    expect(authorizeLocalApiRequest(request('GET', {}), session)).toBe(false)
    expect(authorizeLocalApiRequest(request('GET', {
      cookie: `${LOCAL_API_COOKIE_NAME}=stale`,
    }), session)).toBe(false)
    expect(authorizeLocalApiRequest(request('GET', {
      cookie: `${LOCAL_API_COOKIE_NAME}=${session.token}`,
    }), undefined)).toBe(false)
  })

  it('rejects non-loopback and non-canonical origins', () => {
    expect(() => createLocalApiSession('https://127.0.0.1:43120')).toThrow('loopback')
    expect(() => createLocalApiSession('http://localhost:43120')).toThrow('loopback')
    expect(() => createLocalApiSession('http://127.0.0.1:43120/')).toThrow('loopback')
  })
})
