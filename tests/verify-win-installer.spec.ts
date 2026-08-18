import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsInstaller } from '../scripts/verify-win-installer.ts'

const temporaryRoots: string[] = []

function portableExecutable(): Buffer {
  const executable = Buffer.alloc(132)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(128, 0x3c)
  executable.write('PE\0\0', 128, 'binary')
  return executable
}

function fixture(version = '2.0.0'): {
  readonly root: string
  readonly x64Installer: string
  readonly x64Application: string
  readonly arm64Installer: string
  readonly arm64Application: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-installer-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  const x64Unpacked = join(dist, 'win-unpacked')
  const arm64Unpacked = join(dist, 'win-arm64-unpacked')
  mkdirSync(x64Unpacked, { recursive: true })
  mkdirSync(arm64Unpacked, { recursive: true })
  const x64Installer = join(dist, `HarnessX-${version}-x64-Setup.exe`)
  const x64Application = join(x64Unpacked, 'HarnessX.exe')
  const arm64Installer = join(dist, `HarnessX-${version}-arm64-Setup.exe`)
  const arm64Application = join(arm64Unpacked, 'HarnessX.exe')
  for (const path of [x64Installer, x64Application, arm64Installer, arm64Application]) {
    writeFileSync(path, portableExecutable())
  }
  return { root, x64Installer, x64Application, arm64Installer, arm64Application }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows installer artifact verification', () => {
  it('accepts the exact versioned NSIS installers and unpacked applications', () => {
    const value = fixture()

    expect(verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' })).toEqual({
      artifacts: [
        {
          architecture: 'x64',
          installerPath: value.x64Installer,
          applicationPath: value.x64Application,
        },
        {
          architecture: 'arm64',
          installerPath: value.arm64Installer,
          applicationPath: value.arm64Application,
        },
      ],
    })
  })

  it('rejects a stale installer from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('HarnessX-2.0.0-x64-Setup.exe')
  })

  it('rejects an artifact without a Windows PE header', () => {
    const value = fixture()
    const invalid = portableExecutable()
    invalid.write('NO', 0, 'ascii')
    writeFileSync(value.x64Installer, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE header')
  })

  it('rejects an unpacked application without a Windows PE signature', () => {
    const value = fixture()
    const invalid = portableExecutable()
    invalid.fill(0, 128, 132)
    writeFileSync(value.x64Application, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE signature')
  })

  it('rejects a missing arm64 installer after validating x64', () => {
    const value = fixture()
    rmSync(value.arm64Installer)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('HarnessX-2.0.0-arm64-Setup.exe')
  })
})
