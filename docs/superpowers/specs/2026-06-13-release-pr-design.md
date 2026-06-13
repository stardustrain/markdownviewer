# Release PR Based CD Design

## Context

The current release workflow runs only when a `v*` tag is pushed. When it runs,
it immediately builds the Tauri app and creates a published GitHub Release. This
works, but it puts the responsibility for versioning, changelog generation, and
release timing outside the repository workflow.

The desired model is lower noise: normal merges to `main` should not publish a
release. A human should decide the release moment by merging an explicit release
pull request.

## Goals

- Create and maintain a release PR as releasable commits accumulate on `main`.
- Publish a GitHub Release only after a human merges that release PR.
- Build and upload Tauri artifacts only when a release is actually created.
- Keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
  versions synchronized in the release PR.
- Preserve a simple workflow for a single Tauri desktop app.

## Non-Goals

- Publishing to npm.
- Fully automated release on every merge to `main`.
- Introducing Changesets files for every feature or fix PR.
- Adding macOS code signing or notarization in this change.
- Expanding releases to Windows or Linux artifacts.

## Proposed Approach

Use release-please as the release coordinator and `tauri-action` as the artifact
builder/uploader.

On pushes to `main`, release-please will inspect Conventional Commit messages
and create or update a release PR. That PR will contain version bumps and
changelog updates. Nothing is published just because ordinary code merged.

When the release PR is merged, release-please creates the tag and GitHub Release.
In the same workflow run, a later job or step checks the release-please output
and runs the Tauri build only when `release_created` is true. The Tauri action
uploads the macOS bundles to the release associated with the generated tag.

## Versioning

The root `package.json` remains the primary Node package version source for
release-please's `node` release strategy. The Tauri-specific version files are
updated through release-please `extra-files`:

- `src-tauri/tauri.conf.json` via JSON path `$.version`
- `src-tauri/Cargo.toml` via TOML path `$.package.version`

`src-tauri/Cargo.lock` may also need to reflect the package version after a
release PR. If release-please does not update it directly, the workflow or a
local script should regenerate it during release PR validation rather than
letting the release artifact build from stale metadata.

## Workflow Shape

The release workflow should trigger on pushes to `main`. It should grant the
permissions release-please needs:

- `contents: write`
- `pull-requests: write`
- `issues: write`

The workflow should run release-please first. If no release was created, it
should stop after creating or updating the release PR. If a release was created,
it should check out the repository, install pnpm dependencies, install Rust,
restore Rust cache, and run `tauri-apps/tauri-action`.

The Tauri upload should target the release created by release-please using the
generated tag name or release id. This keeps release notes and versioning owned
by release-please while keeping artifact creation owned by the Tauri tooling.

## Commit Policy

Release version selection depends on Conventional Commit messages:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `type!:` or `BREAKING CHANGE:` creates a major release.
- Non-user-facing changes such as `chore:`, `docs:`, and `test:` should not
  create unnecessary releases unless explicitly configured later.

This policy keeps routine maintenance from becoming release noise.

## Error Handling

If release-please creates or updates a release PR, the workflow should finish
without running Tauri packaging.

If a release is created but Tauri packaging fails, the GitHub Release may exist
without artifacts. The workflow should fail visibly so the release can be fixed
by rerunning the job or by uploading artifacts after the build issue is resolved.

If version files drift, CI should catch it before a release PR is merged. At
minimum, the release implementation should add a focused check that the versions
in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` agree.

## Testing And Verification

Implementation should be verified by:

- Validating workflow YAML syntax where possible.
- Confirming release-please config JSON is valid.
- Running existing tests and build checks locally if dependencies are available.
- Adding or running a version consistency check.
- Reviewing the generated workflow conditions to ensure Tauri build only runs
  when release-please reports that a release was created.

## Open Decisions

The first implementation should keep the current macOS-only artifact scope. It
can continue to produce unsigned builds and keep the existing warning in the
release notes. Signing, notarization, and multi-platform release matrices should
be separate follow-up work.
