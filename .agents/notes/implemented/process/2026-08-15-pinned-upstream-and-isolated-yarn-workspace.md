# Agent Note: Pinned upstream source and flattened Yarn package

Status: implemented

English | [中文](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.zh.md)

## Problem

HarnessX needs the exact official DeepSeek Harness source for review while the desktop product evolves independently. Tracking that source as ordinary files lets desktop commits rewrite upstream implementation and obscures ownership. A shared package-manager graph would also mix upstream pnpm rules with the desktop product's Yarn release.

## Decision

[`deepseek-harness/`](../../../../deepseek-harness/) is a Git submodule pinned to the official repository and exact commit recorded in [`upstream.json`](../../../../upstream.json). Desktop branches treat the submodule as read-only. An upstream update changes the gitlink and metadata in a dedicated commit.

The root README files and assets are product-owned and are not derived from the official source submodule. Package-level setup and release documentation belongs to [`docs/package-reference.en.md`](../../../../docs/package-reference.en.md).

The repository root is the single HarnessX Yarn 4 package using the `node_modules` linker. The committed upstream source snapshot retains its own pnpm workspace under its own [package-manager decision](../../../../deepseek-harness/.agents/notes/implemented/process/2026-06-16-pnpm-over-yarn.md). Root `upstream:*` scripts use Yarn's portable shell to enter that directory before invoking its pinned pnpm release through Corepack.

Normal desktop builds resolve published DSH packages from the npm registry instead of linking source from the snapshot. `upstream.json` records the source version and the runtime package family independently. The committed public GitHub source is `0.1.0-rc.7`, while the desktop runtime uses the published `0.1.0-rc.7` family.

`yarn check:layout` rejects a missing or nested Git directory, changed package-manager boundary, nested desktop package, or DSH runtime family. CI installs the root package immutably, runs the desktop checks, and exercises the upstream command path on Windows.

## Verification

The shipped layout passes `yarn check:layout`, `yarn upstream:version`, `yarn install --immutable`, and `yarn check`. The Loader smoke in `yarn check` activates the built desktop package through Cordis without opening an Electron window.

## Alternatives considered

**Continue carrying upstream as editable root files.** This preserves one checkout but cannot mechanically distinguish official source from desktop-owned changes, which is the ownership failure this structure prevents.

**Vendor the upstream tree with a subtree or copied snapshot.** A copy can record provenance, but it still presents upstream files as ordinary product-owned files and makes accidental patches easy to commit.

**Add the upstream checkout to the Yarn workspace or use source links.** This couples desktop dependency resolution to an unmodified pnpm monorepo and makes product builds depend on unpublished source layout rather than the packages users install.

**Convert the upstream checkout to Yarn.** Package-manager conversion modifies official source and invalidates its lockfile and repository checks. Upstream commands therefore retain pnpm.

**Treat the npm runtime version as proof of a matching source revision.** The published package metadata does not identify such a revision. Keeping source and artifact versions explicit avoids a false provenance claim.

## Consequences

Desktop changes live directly in the root package, and the official checkout remains directly comparable with its remote commit. The root landing page presents HarnessX while the package reference owns detailed usage. Product installs and checks are reproducible from the root Yarn lockfile, while upstream verification continues to use its own pnpm lockfile.

Clones must initialize the submodule, and contributors maintain two intentionally separate package-manager caches. Source-pin updates and runtime-family updates require separate evidence because a public GitHub revision and a published npm family may not correspond.
