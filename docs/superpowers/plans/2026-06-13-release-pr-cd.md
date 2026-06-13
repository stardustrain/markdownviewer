# Release PR CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tag-push releases with a release-please PR flow where a human merges the release PR, then Tauri macOS artifacts are built and uploaded only for that created release.

**Architecture:** release-please owns release PRs, version bumps, changelog generation, tags, and GitHub Release creation. A conditional macOS job runs only when release-please reports `release_created == true`, then `tauri-action` uploads bundles to the generated tag. A small Node script verifies that all app version files stay synchronized.

**Tech Stack:** GitHub Actions, googleapis/release-please-action v4, tauri-apps/tauri-action v0, pnpm 10, Node ESM, Vitest 4, Tauri 2, Rust stable.

---

## File Structure

- Create: `scripts/check-release-versions.mjs`
  - Node ESM CLI and exported parser helpers.
  - Reads `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
  - Exits non-zero when any version differs.
- Create: `scripts/check-release-versions.spec.mjs`
  - Vitest coverage for TOML package parsing, Cargo lock package selection, and mismatch detection.
- Modify: `package.json`
  - Add `check:release-versions`.
- Create: `release-please-config.json`
  - Configure root `node` releaser, `vX.Y.Z` tags, changelog generation, bootstrap SHA, and Tauri/Rust version extra files.
- Create: `.release-please-manifest.json`
  - Bootstrap current root package version as `0.1.0`.
- Modify: `.github/workflows/release.yml`
  - Trigger on `main` pushes, run release-please first, and run Tauri packaging only after a release is created.
- Modify: `.github/workflows/ci.yml`
  - Run the version consistency check in normal CI.

---

### Task 1: Add Version Consistency Checker

**Files:**
- Create: `scripts/check-release-versions.spec.mjs`
- Create: `scripts/check-release-versions.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing parser tests**

Create `scripts/check-release-versions.spec.mjs`:

```js
import {
  findVersionMismatches,
  parseCargoLockPackageVersion,
  parseCargoPackageVersion,
} from "./check-release-versions.mjs";

describe("release version consistency helpers", () => {
  test("Cargo.toml package version is read from the package section", () => {
    const cargoToml = [
      "[workspace]",
      'members = ["src-tauri"]',
      "",
      "[package]",
      'name = "markdownviewer"',
      'version = "1.2.3"',
      "",
      "[dependencies]",
      'serde = "1"',
    ].join("\n");

    expect(parseCargoPackageVersion(cargoToml)).toBe("1.2.3");
  });

  test("Cargo.lock version is read from the markdownviewer package block", () => {
    const cargoLock = [
      "[[package]]",
      'name = "dependency"',
      'version = "9.9.9"',
      "",
      "[[package]]",
      'name = "markdownviewer"',
      'version = "2.0.0"',
      "dependencies = [",
      ' "serde",',
      "]",
    ].join("\n");

    expect(parseCargoLockPackageVersion(cargoLock, "markdownviewer")).toBe("2.0.0");
  });

  test("version mismatches report every file that differs from package.json", () => {
    const mismatches = findVersionMismatches({
      "package.json": "1.0.0",
      "src-tauri/tauri.conf.json": "1.0.1",
      "src-tauri/Cargo.toml": "1.0.0",
      "src-tauri/Cargo.lock": "0.9.0",
    });

    expect(mismatches).toEqual([
      ["src-tauri/tauri.conf.json", "1.0.1"],
      ["src-tauri/Cargo.lock", "0.9.0"],
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm vitest run scripts/check-release-versions.spec.mjs
```

Expected: FAIL because `scripts/check-release-versions.mjs` does not exist.

- [ ] **Step 3: Add the checker implementation**

Create `scripts/check-release-versions.mjs`:

```js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_PACKAGE_NAME = "markdownviewer";

export function parseCargoPackageVersion(content) {
  const packageSection = content.match(
    /(?:^|\n)\[package\]\n(?<body>[\s\S]*?)(?=\n\[|$)/,
  )?.groups?.body;
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];

  if (!version) {
    throw new Error("Unable to read package.version from src-tauri/Cargo.toml");
  }

  return version;
}

export function parseCargoLockPackageVersion(content, packageName) {
  const packageBlocks = content.split(/\n(?=\[\[package\]\]\n)/);
  const packageBlock = packageBlocks.find((block) =>
    new RegExp(`^name\\s*=\\s*"${escapeRegExp(packageName)}"$`, "m").test(block),
  );
  const version = packageBlock?.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];

  if (!version) {
    throw new Error(`Unable to read ${packageName} version from src-tauri/Cargo.lock`);
  }

  return version;
}

export function collectReleaseVersions(rootDir = process.cwd()) {
  const packageJson = JSON.parse(
    readFileSync(resolve(rootDir, "package.json"), "utf8"),
  );
  const tauriConfig = JSON.parse(
    readFileSync(resolve(rootDir, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const cargoToml = readFileSync(resolve(rootDir, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(resolve(rootDir, "src-tauri/Cargo.lock"), "utf8");

  return {
    "package.json": packageJson.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": parseCargoPackageVersion(cargoToml),
    "src-tauri/Cargo.lock": parseCargoLockPackageVersion(
      cargoLock,
      APP_PACKAGE_NAME,
    ),
  };
}

export function findVersionMismatches(versions) {
  const expectedVersion = versions["package.json"];

  return Object.entries(versions).filter(
    ([path, version]) => path !== "package.json" && version !== expectedVersion,
  );
}

export function formatVersionReport(versions) {
  return Object.entries(versions)
    .map(([path, version]) => `${path}: ${version}`)
    .join("\n");
}

export function main(rootDir = process.cwd()) {
  const versions = collectReleaseVersions(rootDir);
  const mismatches = findVersionMismatches(versions);

  if (mismatches.length > 0) {
    console.error("Release version files are out of sync:");
    console.error(formatVersionReport(versions));
    return 1;
  }

  console.log(`Release versions are consistent: ${versions["package.json"]}`);
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm vitest run scripts/check-release-versions.spec.mjs
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Add the package script**

Modify `package.json` scripts by adding `check:release-versions` after `typecheck`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "prepare": "husky",
    "typecheck": "tsc",
    "check:release-versions": "node scripts/check-release-versions.mjs"
  }
}
```

- [ ] **Step 6: Run the checker against the real repository**

Run:

```bash
pnpm check:release-versions
```

Expected: PASS and output `Release versions are consistent: 0.1.0`.

- [ ] **Step 7: Commit the checker**

Run:

```bash
git add package.json scripts/check-release-versions.mjs scripts/check-release-versions.spec.mjs
git commit -m "test: add release version consistency check"
```

Expected: commit succeeds.

---

### Task 2: Add Release Please Configuration

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1: Add release-please config**

Create `release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "include-component-in-tag": false,
  "bootstrap-sha": "4809394516814d148829808f6afa22117bb7ba20",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "markdownviewer",
      "changelog-path": "CHANGELOG.md",
      "extra-files": [
        {
          "type": "json",
          "path": "src-tauri/tauri.conf.json",
          "jsonpath": "$.version"
        },
        {
          "type": "toml",
          "path": "src-tauri/Cargo.toml",
          "jsonpath": "$.package.version"
        },
        {
          "type": "toml",
          "path": "src-tauri/Cargo.lock",
          "jsonpath": "$.package[?(@.name.value=='markdownviewer')].version"
        }
      ]
    }
  }
}
```

Why this shape:

- `include-component-in-tag: false` keeps tags as `v0.1.1`, matching the current `v*` release convention.
- `bootstrap-sha` prevents the first release PR from collecting the whole repository history before the current `main`.
- `src-tauri/Cargo.lock` uses the TOML updater JSONPath form that selects the `markdownviewer` package block.

- [ ] **Step 2: Add release-please manifest**

Create `.release-please-manifest.json`:

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 3: Validate JSON syntax**

Run:

```bash
node -e 'for (const file of ["release-please-config.json", ".release-please-manifest.json"]) { JSON.parse(require("node:fs").readFileSync(file, "utf8")); console.log(`${file}: ok`); }'
```

Expected:

```text
release-please-config.json: ok
.release-please-manifest.json: ok
```

- [ ] **Step 4: Commit release-please config**

Run:

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: configure release-please"
```

Expected: commit succeeds. The commit type is `ci:` so it does not create a user-facing release entry.

---

### Task 3: Replace Tag-Push Release Workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace release workflow content**

Replace `.github/workflows/release.yml` with:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - name: Create or update release PR
        id: release
        uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  build-tauri:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    permissions:
      contents: write
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Check release versions
        run: pnpm check:release-versions

      - name: Build and upload macOS release assets
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ needs.release-please.outputs.tag_name }}
          releaseDraft: false
          prerelease: false
```

Notes:

- The workflow no longer runs on arbitrary `v*` tag pushes.
- `release-please` runs on every `main` push, but it only creates or updates the release PR until that PR is merged.
- `build-tauri` is skipped unless release-please creates a release.
- `RELEASE_PLEASE_TOKEN` is optional. When configured as a PAT, release-please-created PRs can trigger normal CI. Without it, `GITHUB_TOKEN` keeps the workflow secret-free but GitHub may suppress workflows triggered by the generated PR.

- [ ] **Step 2: Validate YAML parses**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml"); puts "release workflow yaml: ok"'
```

Expected:

```text
release workflow yaml: ok
```

- [ ] **Step 3: Commit release workflow**

Run:

```bash
git add .github/workflows/release.yml
git commit -m "ci: run releases through release PRs"
```

Expected: commit succeeds.

---

### Task 4: Add Version Check To CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add version check after dependency install**

Modify `.github/workflows/ci.yml` so the job steps start like this:

```yaml
      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Check release versions
        run: pnpm check:release-versions

      - name: Run tests
        run: pnpm test
```

- [ ] **Step 2: Validate YAML parses**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml"); puts "ci workflow yaml: ok"'
```

Expected:

```text
ci workflow yaml: ok
```

- [ ] **Step 3: Commit CI check**

Run:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: check release version consistency"
```

Expected: commit succeeds.

---

### Task 5: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused checker tests**

Run:

```bash
pnpm vitest run scripts/check-release-versions.spec.mjs
```

Expected: PASS with 3 tests.

- [ ] **Step 2: Run version consistency check**

Run:

```bash
pnpm check:release-versions
```

Expected: PASS and output `Release versions are consistent: 0.1.0`.

- [ ] **Step 3: Run full frontend tests**

Run:

```bash
pnpm test
```

Expected: PASS for all existing Vitest suites plus `scripts/check-release-versions.spec.mjs`.

- [ ] **Step 4: Run frontend build**

Run:

```bash
pnpm build
```

Expected: `tsc && vite build` exits 0.

- [ ] **Step 5: Run Rust check**

Run:

```bash
cargo check
```

Working directory: `src-tauri`

Expected: exits 0.

- [ ] **Step 6: Confirm release workflow gating**

Run:

```bash
rg -n "branches: \\[main\\]|release_created|tagName|v\\*" .github/workflows/release.yml
```

Expected:

```text
.github/workflows/release.yml:5:    branches: [main]
.github/workflows/release.yml:19:      release_created: ${{ steps.release.outputs.release_created }}
.github/workflows/release.yml:29:    if: ${{ needs.release-please.outputs.release_created == 'true' }}
.github/workflows/release.yml:68:          tagName: ${{ needs.release-please.outputs.tag_name }}
```

There should be no `v*` tag trigger in the output.

- [ ] **Step 7: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected:

- `git status --short` is empty.
- Recent commits include:
  - `test: add release version consistency check`
  - `ci: configure release-please`
  - `ci: run releases through release PRs`
  - `ci: check release version consistency`

---

## Self-Review

- **Spec coverage:** Release PR creation is Task 2 and Task 3. Human-controlled release timing is Task 3 via release-please PR flow. Tauri artifacts build only on release creation in Task 3. Version synchronization is Task 1, Task 2, and Task 4. Existing macOS-only unsigned scope is preserved in Task 3.
- **Placeholder scan:** No placeholder terms are present. Each changed file has exact content or exact insertion snippets. Each verification step has a concrete command and expected result.
- **Type consistency:** The package name is consistently `markdownviewer`. Workflow outputs use `release_created` and `tag_name` from `steps.release.outputs`. The release artifact job reads those values through `needs.release-please.outputs`.
