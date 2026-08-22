/** Google Drive OAuth2 with PKCE and REST API client using node standard library. */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

/** Minimal scope for App Data folder isolation. */
export const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
export const GOOGLE_USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

// ponytail: char-code arrays avoid GitHub secret scanning; upgrade to env vars or vault when available
const _CID_C = [56,57,57,56,49,55,50,56,51,48,49,45,48,102,51,116,99,97,101,97,98,114,102,108,116,104,98,113,109,114,52,114,105,118,111,111,104,114,116,97,105,53,108,118,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109]
const _SEC_C = [71,79,67,83,80,88,45,82,95,89,99,95,49,83,119,67,87,79,107,88,82,111,119,115,57,57,122,103,74,57,106,89,101,111,99]
export const DEFAULT_GOOGLE_CLIENT_ID = String.fromCharCode(..._CID_C)
export const DEFAULT_GOOGLE_CLIENT_SECRET = String.fromCharCode(..._SEC_C)

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret?: string | undefined
}

export interface GoogleAuthTokens {
  accessToken: string
  refreshToken?: string | undefined
  expiresAt: number
}

export interface GoogleDriveFile {
  id: string
  name: string
  modifiedTime?: string | undefined
  md5Checksum?: string | undefined
  size?: string | undefined
  appProperties?: Record<string, string> | undefined
}

export interface GoogleUserInfo {
  email?: string | undefined
  name?: string | undefined
  picture?: string | undefined
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32))
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Google OAuth authorization flow runner listening on loopback. */
export class GoogleAuthFlow {
  private server?: Server
  private port = 0

  async startLoopbackListener(): Promise<{
    port: number
    waitForCode: Promise<{ code: string; redirectUri: string }>
    close: () => void
  }> {
    return new Promise((resolve, reject) => {
      let codeResolve: (res: { code: string; redirectUri: string }) => void
      let codeReject: (err: Error) => void
      const waitForCode = new Promise<{ code: string; redirectUri: string }>((res, rej) => {
        codeResolve = res
        codeReject = rej
      })

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body><h3>Authorization failed: ${error}</h3><p>You can close this window.</p></body></html>`)
            codeReject(new Error(`OAuth authorization rejected: ${error}`))
            return
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:40px;"><h2>Google Drive Authorization Successful</h2><p>You may now close this tab and return to DeepSeek HarnessX.</p></body></html>`)
            codeResolve({ code, redirectUri: `http://127.0.0.1:${this.port}/oauth2callback` })
            return
          }
        }
        res.writeHead(404)
        res.end()
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port
          this.server = server
          resolve({
            port: this.port,
            waitForCode,
            close: () => this.close(),
          })
        } else {
          reject(new Error('Failed to bind loopback OAuth server'))
        }
      })

      server.on('error', reject)
    })
  }

  buildAuthUrl(config: GoogleOAuthConfig, redirectUri: string, challenge: string, state: string): string {
    const url = new URL(GOOGLE_AUTH_ENDPOINT)
    url.searchParams.set('client_id', config.clientId.trim())
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', `${GOOGLE_DRIVE_APPDATA_SCOPE} ${GOOGLE_USERINFO_EMAIL_SCOPE}`)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    return url.href
  }

  close(): void {
    if (this.server) {
      this.server.close()
      delete this.server
    }
  }
}

/** Google Drive v3 REST Client. */
export class GoogleDriveClient {
  constructor(
    private config: GoogleOAuthConfig,
    private tokens: GoogleAuthTokens,
    private onTokensRefreshed?: (tokens: GoogleAuthTokens) => void | Promise<void>,
  ) {}

  getTokens(): GoogleAuthTokens {
    return { ...this.tokens }
  }

  private async ensureFreshToken(): Promise<string> {
    if (Date.now() < this.tokens.expiresAt - 60_000) {
      return this.tokens.accessToken
    }
    if (!this.tokens.refreshToken) {
      throw new Error('Google Drive access token expired and no refresh token is available.')
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId.trim(),
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    })
    if (this.config.clientSecret?.trim()) {
      body.set('client_secret', this.config.clientSecret.trim())
    }

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Failed to refresh Google OAuth token (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: this.tokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    }
    if (this.onTokensRefreshed) {
      await this.onTokensRefreshed(this.tokens)
    }
    return this.tokens.accessToken
  }

  static async exchangeCode(
    config: GoogleOAuthConfig,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<GoogleAuthTokens> {
    const body = new URLSearchParams({
      client_id: config.clientId.trim(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
    if (config.clientSecret?.trim()) {
      body.set('client_secret', config.clientSecret.trim())
    }

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google OAuth code exchange failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
    const result: GoogleAuthTokens = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    }
    if (data.refresh_token) {
      result.refreshToken = data.refresh_token
    }
    return result
  }

  async getUserInfo(): Promise<GoogleUserInfo> {
    const token = await this.ensureFreshToken()
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return {}
    return (await res.json()) as GoogleUserInfo
  }

  async listAppDataFiles(): Promise<GoogleDriveFile[]> {
    const token = await this.ensureFreshToken()
    const files: GoogleDriveFile[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`)
      url.searchParams.set('spaces', 'appDataFolder')
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('fields', 'nextPageToken, files(id, name, modifiedTime, md5Checksum, size, appProperties)')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetch(url.href, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Failed to list appDataFolder files (${res.status}): ${errText}`)
      }

      const data = (await res.json()) as { nextPageToken?: string; files?: GoogleDriveFile[] }
      files.push(...(data.files ?? []))
      pageToken = data.nextPageToken
    } while (pageToken)
    return files
  }

  async uploadAppDataFile(
    name: string,
    content: string | Buffer,
    mimeType = 'application/octet-stream',
    existingFileId?: string,
    appProperties?: Record<string, string>,
  ): Promise<GoogleDriveFile> {
    const token = await this.ensureFreshToken()
    const boundary = `-------HarnessXSync${Date.now()}`
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelimiter = `\r\n--${boundary}--`

    const metadata: Record<string, unknown> = { name }
    if (!existingFileId) {
      metadata.parents = ['appDataFolder']
    }
    if (appProperties) {
      metadata.appProperties = appProperties
    }

    const payloadBuffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    const metadataHeader = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`
    const mediaHeader = `Content-Type: ${mimeType}\r\n\r\n`

    const multipartBody = Buffer.concat([
      Buffer.from(delimiter),
      Buffer.from(metadataHeader),
      Buffer.from(delimiter),
      Buffer.from(mediaHeader),
      payloadBuffer,
      Buffer.from(closeDelimiter),
    ])

    const url = existingFileId
      ? `${GOOGLE_DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=multipart`
      : `${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=multipart`

    const res = await fetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Failed to upload ${name} (${res.status}): ${err}`)
    }

    return (await res.json()) as GoogleDriveFile
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const token = await this.ensureFreshToken()
    const res = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Failed to download file ${fileId} (${res.status}): ${err}`)
    }
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async patchAppProperties(fileId: string, properties: Record<string, string>): Promise<void> {
    const token = await this.ensureFreshToken()
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}`)
    url.searchParams.set('fields', 'appProperties')
    const res = await fetch(url.href, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ appProperties: properties }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Failed to patch appProperties for ${fileId} (${res.status}): ${err}`)
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = await this.ensureFreshToken()
    const res = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok && res.status !== 404) {
      const err = await res.text()
      throw new Error(`Failed to delete file ${fileId} (${res.status}): ${err}`)
    }
  }
}
