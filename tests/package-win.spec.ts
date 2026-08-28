import { describe, expect, it } from 'vitest'
import {
  packageWindowsInstaller,
  type WindowsPackageOptions,
} from '../scripts/package-win.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

interface ChecksumCall {
  readonly releaseDir: string
  readonly version: string
}

function options(calls: CommandCall[], logs: string[] = []): {
  value: WindowsPackageOptions
  checksumCalls: ChecksumCall[]
} {
  const checksumCalls: ChecksumCall[] = []
  const value: WindowsPackageOptions = {
    env: {
      PATH: 'C:\\Windows\\System32',
      SAFE_VALUE: 'kept',
      CSC_LINK: 'private-generic-certificate',
      csc_key_password: 'private-generic-password',
      win_csc_link: 'C:\\private\\publisher.pfx',
      WIN_CSC_KEY_PASSWORD: 'private-windows-password',
    },
    platform: 'win32',
    arch: 'x64',
    nodeVersion: '22.23.2',
    workspaceRoot: 'C:\\repo',
    desktopRoot: 'C:\\repo',
    version: '2.0.0',
    commandShell: 'C:\\Windows\\System32\\cmd.exe',
    builderCli: 'C:\\repo\\node_modules\\electron-builder\\cli.js',
    manifestMerger: 'C:\\repo\\scripts\\merge-update-manifests.ts',
    verifier: 'C:\\repo\\scripts\\verify-win-installer.ts',
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
    run: (command, args, cwd, env) => {
      calls.push({ command, args: [...args], cwd, env: { ...env } })
    },
    log: message => logs.push(message),
    writeChecksums: (releaseDir, version) => {
      checksumCalls.push({ releaseDir, version })
    },
  }
  return { value, checksumCalls }
}

describe('Windows multi-architecture installer packaging', () => {
  it('checks without credentials, builds unsigned x64 and arm64 NSIS and portable targets, then verifies them', () => {
    const calls: CommandCall[] = []
    const logs: string[] = []
    const { value, checksumCalls } = options(calls, logs)

    packageWindowsInstaller(value)

    expect(calls).toHaveLength(5)
    expect(calls[0]).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'corepack yarn check:win-package',
      ],
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\Windows\\System32', SAFE_VALUE: 'kept' },
    })
    for (const [index, architecture] of (['x64', 'arm64'] as const).entries()) {
      expect(calls[index + 1]).toEqual({
        command: 'C:\\Program Files\\nodejs\\node.exe',
        args: [
          'C:\\repo\\node_modules\\electron-builder\\cli.js',
          '--win',
          'nsis',
          'zip',
          `--${architecture}`,
          '--publish',
          'never',
          '--config.directories.output=dist/2.0.0',
          '--config.win.signExecutable=false',
          '--config.npmRebuild=false',
        ],
        cwd: 'C:\\repo',
        env: {
          PATH: 'C:\\Windows\\System32',
          SAFE_VALUE: 'kept',
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        },
      })
    }
    expect(calls[3]).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\repo\\scripts\\merge-update-manifests.ts'],
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\Windows\\System32', SAFE_VALUE: 'kept' },
    })
    expect(calls[4]).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\repo\\scripts\\verify-win-installer.ts'],
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\Windows\\System32', SAFE_VALUE: 'kept' },
    })
    expect(logs).toEqual([
      'Building unsigned Windows x64 and arm64 installers into dist/2.0.0; Authenticode is a separate release step.',
      'Merging multi-architecture update manifests.',
      'Writing SHA-256 checksums.',
    ])
    expect(checksumCalls).toEqual([{ releaseDir: 'C:\\repo\\dist\\2.0.0', version: '2.0.0' }])
  })

  it.each([
    ['darwin', 'x64', '22.23.2', 'native Windows host'],
    ['win32', 'arm64', '22.23.2', 'requires x64 Node'],
    ['win32', 'x64', '25.0.0', 'Node 22.19+ or Node 24.x'],
  ] as const)(
    'rejects unsupported host %s/%s with Node %s before running commands',
    (platform, arch, nodeVersion, message) => {
    const calls: CommandCall[] = []
      const { value } = options(calls)
      const broken: WindowsPackageOptions = { ...value, platform, arch, nodeVersion }

      expect(() => packageWindowsInstaller(broken)).toThrow(message)
      expect(calls).toEqual([])
    },
  )

  it('stops before packaging when the headless check fails', () => {
    const calls: CommandCall[] = []
    const { value } = options(calls)
    const failing: WindowsPackageOptions = {
      ...value,
      run: (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env: { ...env } })
        throw new Error('headless check failed')
      },
    }

    expect(() => packageWindowsInstaller(failing)).toThrow('headless check failed')
    expect(calls).toHaveLength(1)
  })
})
