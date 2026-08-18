/** Verify the unsigned Windows x64 and arm64 NSIS installers and unpacked executables. */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Windows architectures emitted by the desktop release build. */
export type WindowsInstallerArchitecture = 'x64' | 'arm64'

/** Paths returned for one verified Windows architecture. */
export interface WindowsInstallerArtifact {
  /** Architecture targeted by the installer and unpacked application. */
  readonly architecture: WindowsInstallerArchitecture
  /** NSIS installer path. */
  readonly installerPath: string
  /** Unpacked application executable path. */
  readonly applicationPath: string
}

/** Paths returned after all Windows installer verifications succeed. */
export interface WindowsInstallerArtifacts {
  /** Verified artifacts in stable release order. */
  readonly artifacts: readonly WindowsInstallerArtifact[]
}

/** Injectable Windows installer verification boundary. */
export interface WindowsInstallerVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

function assertPortableExecutable(path: string, label: string): void {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) {
    throw new Error(`${label} is not a non-empty regular file: ${path}`)
  }
  const descriptor = openSync(path, 'r')
  const dosHeader = Buffer.alloc(64)
  try {
    const dosBytesRead = readSync(descriptor, dosHeader, 0, dosHeader.byteLength, 0)
    if (dosBytesRead !== dosHeader.byteLength || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} does not have a Windows PE header: ${path}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > stat.size - 4) {
      throw new Error(`${label} has an invalid Windows PE offset: ${path}`)
    }
    const signature = Buffer.alloc(4)
    const signatureBytesRead = readSync(descriptor, signature, 0, signature.byteLength, peOffset)
    if (signatureBytesRead !== signature.byteLength || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} does not have a Windows PE signature: ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function defaultOptions(): WindowsInstallerVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
  }
}

/**
 * Verify the exact NSIS installer and unpacked application executable.
 * @param options - Artifact root and expected product version.
 * @returns The verified artifact paths.
 */
export function verifyWindowsInstaller(
  options: WindowsInstallerVerificationOptions = defaultOptions(),
): WindowsInstallerArtifacts {
  const distDir = join(options.desktopRoot, 'dist')
  const artifacts = (['x64', 'arm64'] as const).map((architecture) => {
    const installerPath = join(
      distDir,
      `HarnessX-${options.version}-${architecture}-Setup.exe`,
    )
    const unpackedDirectory = architecture === 'x64' ? 'win-unpacked' : 'win-arm64-unpacked'
    const applicationPath = join(distDir, unpackedDirectory, 'HarnessX.exe')

    assertPortableExecutable(installerPath, `Windows ${architecture} NSIS installer`)
    assertPortableExecutable(applicationPath, `unpacked Windows ${architecture} application`)
    return { architecture, installerPath, applicationPath }
  })
  return { artifacts }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyWindowsInstaller()
    for (const artifact of verified.artifacts) {
      console.log(
        `Windows ${artifact.architecture} installer verification passed: ${artifact.installerPath}`,
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
