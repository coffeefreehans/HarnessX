# HarnessX

<p align="center">
  <a href="https://github.com/coffeefreehans/HarnessX/stargazers"><img src="https://img.shields.io/github/stars/coffeefreehans/HarnessX?style=flat" alt="GitHub stars"></a>
  <a href="https://github.com/coffeefreehans/HarnessX/releases"><img src="https://img.shields.io/github/v/release/coffeefreehans/HarnessX?display_name=tag" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Windows-x64%20%7C%20ARM64-0078D4?style=flat" alt="Windows x64 and ARM64">
</p>

<p align="center"><sub><a href="README.md">中文</a> · English</sub></p>

HarnessX is an independently maintained desktop client for DeepSeek Harness. It owns the Electron window, system tray, local runtime, terminal, profile switching, and plugin management while composing the agents, sessions, tools, and Web UI from a pinned DeepSeek Harness source snapshot.

Release `v0.1` is available from the independent public repository with x64 and ARM64 installers for Windows and macOS. Portable archives remain local test artifacts and are not uploaded to the public Release.

## Downloads

| Architecture | Installer |
| --- | --- |
| Windows x64 | [Download EXE](https://github.com/coffeefreehans/HarnessX/releases/download/v0.1/HarnessX-0.1-x64-Setup.exe) |
| Windows ARM64 | [Download EXE](https://github.com/coffeefreehans/HarnessX/releases/download/v0.1/HarnessX-0.1-arm64-Setup.exe) |
| macOS Intel x64 | [Download DMG](https://github.com/coffeefreehans/HarnessX/releases/download/v0.1/HarnessX-0.1-x64.dmg) |
| macOS Apple Silicon ARM64 | [Download DMG](https://github.com/coffeefreehans/HarnessX/releases/download/v0.1/HarnessX-0.1-arm64.dmg) |

[SHA-256 checksums](https://github.com/coffeefreehans/HarnessX/releases/download/v0.1/SHA256SUMS.txt)

> The Windows and macOS artifacts are not publisher-signed. Windows SmartScreen may show an unknown-publisher warning, and macOS may require manual approval in System Settings. Verify the SHA-256 checksum after downloading.

## Available Features

- Native desktop window and system tray
- Local DeepSeek Harness service lifecycle management
- Compatibility and desktop-enhanced presentation modes
- Profile listing, switching, and restart recovery
- Native Windows terminal entry point
- Plugin sources, catalog, and installation job management
- Application update checks and installer downloads
- Separate Windows x64 and ARM64 installers and local portable test builds

## Security Boundaries

- Desktop APIs use a random per-launch HttpOnly session token; mutating requests also require the exact local Origin.
- Model credentials are encrypted through operating-system storage: DPAPI on Windows and Keychain on macOS. A legacy plaintext credential file is removed after a successful migration.
- Plugin installation disables dependency lifecycle scripts and does not grant wildcard native-build approval.
- Third-party plugins still share the Host process. At-rest encryption cannot stop a malicious enabled in-process plugin from calling the Host credential service, so only trusted plugins should be installed.

See the [plugin marketplace design](docs/plugin-market.md) for its data model, APIs, and security boundaries. Public services for desktop plugins are documented in the [desktop plugin API](docs/plugin-services.md).

## Run From Source

Requirements:

- Node.js 22.19+ or Node.js 24
- Corepack
- Git

```sh
git clone https://github.com/coffeefreehans/HarnessX.git
cd HarnessX
corepack yarn install --immutable
corepack yarn dev
```

Common checks and packaging commands:

```sh
corepack yarn check
corepack yarn dist:win
```

The outer desktop project uses Yarn. `deepseek-harness/` is a pinned upstream source snapshot that retains its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/`, `tests/`, `scripts/` | Electron bootstrap, Host/Client plugins, tests, packaging, and release checks |
| `deepseek-harness/` | Pinned DeepSeek Harness upstream source snapshot |
| `docs/` | User, architecture, plugin development, and marketplace documentation |
| `patches/` | Dependency patches required by the desktop release |

Further reading:

- [User guide](docs/user-guide.en.md)
- [Architecture](docs/architecture.en.md)
- [Plugin development](docs/plugin-development.en.md)
- [Package-level reference](docs/package-reference.en.md)

## Upstream Projects and License

HarnessX is an independently maintained community project and is not an official DeepSeek product.

The project composes a pinned release of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and uses the plugin model provided by [Cordis](https://github.com/cordiverse/cordis). Each upstream component remains subject to its own license and copyright notices.

This repository is distributed under the [MIT License](LICENSE). Existing copyright and license notices must be retained in redistributed copies as required by the MIT terms.
