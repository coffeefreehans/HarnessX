/** Per-launch authorization for browser requests to desktop-owned local APIs. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** HttpOnly cookie carrying the per-launch desktop API secret. */
export const LOCAL_API_COOKIE_NAME = 'harnessxLocalSession'

/** One in-memory authorization session bound to a single renderer origin. */
export interface LocalApiSession {
  /** Exact loopback origin allowed to issue state-changing requests. */
  readonly origin: string
  /** Random secret retained only by the Electron main process. */
  readonly token: string
}

/** Create a cryptographically random session for one loopback renderer origin. */
export function createLocalApiSession(origin: string): LocalApiSession {
  const parsed = new URL(origin)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.origin !== origin) {
    throw new Error('harnessx-desktop: local API session requires an exact loopback HTTP origin')
  }
  return { origin, token: randomBytes(32).toString('base64url') }
}

/** Verify the HttpOnly session cookie and the Origin of every mutating request. */
export function authorizeLocalApiRequest(
  request: Pick<IncomingMessage, 'headers' | 'method'>,
  session: LocalApiSession | undefined,
): boolean {
  if (session === undefined) return false
  const token = cookieValue(request.headers.cookie, LOCAL_API_COOKIE_NAME)
  if (token === undefined || !safeEqual(token, session.token)) return false
  if (request.method === 'GET' || request.method === 'HEAD') return true
  return request.headers.origin === session.origin
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return value.length === 0 ? undefined : value
  }
  return undefined
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}
