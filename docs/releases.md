# Releases and distribution

## Access

[GitHub Releases](https://github.com/enzovalley9/agile-project-ui/releases) contains public, versioned connector packages and release notes. No GitHub account is required to read the source or download release assets. If a release link returns 404, check the repository address and published tag rather than assuming that sign-in is required.

The MIT license applies to first-party copies you receive. Repository visibility and license permissions are separate decisions. Do not publish private planning documents, credentials, local session files or user projects with a release.

## Select a connector package

Choose the published archive matching your operating system and processor. Available native build targets are listed in each release; a source-supported architecture is not necessarily a published or verified package.

The archive name follows `agile-project-ui-connectors-SYSTEM-ARCH.tar.gz`. `darwin`, `win32` and `linux` identify macOS, Windows and Linux; `arm64` and `x64` identify the processor architecture. All archives use `.tar.gz`, including Windows.

Extract the complete archive, verify its checksum against the release, then follow the [installation and connection guide](connector-setup.md). The package includes Node.js, the launcher, verified installer, project license and third-party notices. Git is not bundled.

Packages are unsigned and not notarized. A checksum can detect changed bytes; it does not replace publisher authentication or an operating-system signature. Download only from the expected repository and do not disable operating-system protections to run an untrusted archive.

## Verify a download

Use the exact downloaded filename below and compare the complete value with the release's published SHA-256 checksum.

```sh
# macOS
shasum -a 256 agile-project-ui-connectors-darwin-arm64.tar.gz
# Linux
sha256sum agile-project-ui-connectors-linux-x64.tar.gz
```

```powershell
# Windows
Get-FileHash .\agile-project-ui-connectors-win32-x64.tar.gz -Algorithm SHA256
```

The installer additionally validates packaged file hashes before completing installation. It preserves an existing installation and does not start a background service.

## Update or remove

Stop every running connector before updating. Preserve its private session/credential directory and any unresolved operation journals. Extract the new release separately and follow the [verified update and rollback procedure](connector-setup.md#updates-and-rollback). An explicit `--update --confirm-stopped` verifies both packages, stages the new installation and retains the previous version; `--rollback --confirm-stopped` restores it. An ordinary installation never replaces an existing destination. Use `--destination ABSOLUTE_DIRECTORY` if you prefer a separate installation.

To uninstall, stop the connector processes and remove the specific installed package folder. Project documents and separately stored credentials/journals are not part of that folder. Removing an application package does not resolve an uncertain Git or provider operation.

## Reproduce a build

A release should identify its exact source tag/commit and passing CI run. With source access, check out that revision, use the pinned Node runtime, install the committed lockfile with `npm ci`, and run the [documented checks](testing.md).

```sh
npm run build
node scripts/package-connectors.mjs
node scripts/smoke-package.mjs
```

Packaging fetches the pinned official Node runtime and verifies its upstream SHA-256. USTAR headers use fixed ownership, timestamps and permission bits (0755 for Unix entry points/runtime, 0644 for ordinary files), independent of the builder filesystem. The release gate checks archive headers and every manifest hash before upload. Native CI checks the installed runtime on its actual operating system; merely producing a cross-platform archive does not prove it runs on that target. Connector smoke tests and live provider account acceptance are separate.

See [CHANGELOG.md](../CHANGELOG.md) for user-visible changes and the [development release checklist](development.md#dependency-and-release-changes) for maintainer responsibilities.

## Maintainer release workflow

1. Update the package version and its matching changelog section, complete the documented checks, then push the reviewed commit to `main`.
2. Wait for **Verify application and connectors** to pass all ten required jobs at that exact commit, including all six native builds, Chromium, Edge, repository hygiene, Docker acceptance and the static frontend/local connector journey.
3. Run **Release verified connector packages** through GitHub Actions' manual workflow dispatch on `main`. Select `expected_visibility: public` for this repository. Use `private` only for an intentionally private repository. This input is a check, not a visibility-change command.
4. The workflow validates the six native CI packages and their provenance, generates the source dependency SBOM, creates a draft, uploads the archives, SBOM and checksums, and verifies their remote hashes before publishing the release. Inspect the workflow result and release assets before sharing the link.

The workflow supports both private and public repositories and never changes visibility. It requires the explicitly selected visibility to match the repository before validation, before mutation, before publication and after publication; either direction of visibility drift aborts the run. It rejects an existing release, a conflicting tag, incomplete CI, or a changed `main` revision. Creation retains the release ID returned by GitHub; uploads and publication use that exact ID rather than rediscovering unpublished drafts through a release list. The contract in `scripts/release-contract.mjs` names the required jobs, critical successful steps and native artifacts. Regression tests compare it with the real CI matrix and steps, including Docker; adding, dropping or renaming a job requires an intentional contract update. Every required job must succeed at the release commit, and additional or duplicate jobs are rejected.

If an operation fails or has an uncertain outcome, inspect the retained draft/release before retrying. The workflow never deletes, replaces, retargets or automatically resumes a release. A maintainer may deliberately supply the inspected numeric `resume_draft_id` in a new manual dispatch. That selected draft must already belong to this repository, use the current version tag and deterministic release title, target the exact tested `main` commit, and remain an unpublished stable draft. Any tag must resolve to the same commit. If the source changed, inspecting and explicitly updating an empty draft's target is a separate maintainer decision; the workflow does not do it.

Resume accepts either an empty draft or all fourteen already-uploaded assets (six native archives, one source SBOM and seven checksums) with exactly the expected filenames, sizes and SHA-256 digests. Partial, unexpected or mismatching assets stop the workflow without overwriting anything. Exact-commit CI and native package validation still run. On explicit resume, publication refreshes the release notes from the verified changelog and current CI provenance, while preserving the selected draft ID, tag, target and existing verified assets.

To validate a selected draft without changing it, run `node scripts/create-release.mjs --expected-visibility private --check --resume-draft-id RELEASE_ID` from a clean checkout with `GITHUB_REPOSITORY`, `GITHUB_SHA` and `GITHUB_REF=refs/heads/main` set to the expected repository and exact commit. Normal first-time validation omits `--resume-draft-id`. Use `--expected-visibility public` for a public repository. Omitting the visibility policy is rejected even for read-only validation. Actual publication remains restricted to manual GitHub Actions dispatch.

## Native release matrix

The release gate requires every target below to pass the complete build, installed-package smoke, Git project-binding and Jira health/auth checks on its actual platform. Do not describe an archive as available until that version's release contains it. Version 0.1.0 contained only macOS ARM64, Linux x64 and Windows x64; its published assets are preserved.

| Operating system | Processor     | CI runner          | Archive suffix |
| ---------------- | ------------- | ------------------ | -------------- |
| Linux            | x64           | `ubuntu-latest`    | `linux-x64`    |
| Linux            | ARM64         | `ubuntu-24.04-arm` | `linux-arm64`  |
| macOS            | Apple silicon | `macos-latest`     | `darwin-arm64` |
| macOS            | Intel         | `macos-15-intel`   | `darwin-x64`   |
| Windows          | x64           | `windows-latest`   | `win32-x64`    |
| Windows          | ARM64         | `windows-11-arm`   | `win32-arm64`  |

Each job checks its actual OS and architecture before packaging; a moving runner alias cannot silently publish a mislabeled package. Node's pinned upstream checksum inventory must contain the matching runtime. These are [standard GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), available to private as well as public repositories. Private runs consume the account's Actions minutes; do not enable paid overages without approval. Build acceptance on these runners does not imply support for every older OS, Linux distribution or provider deployment.

## Source SBOM and signed provenance

Each release includes `agile-project-ui-source-sbom.spdx.json` and its SHA-256 checksum. This SPDX 2.3 source inventory describes the committed npm lockfile (including development and optional dependencies) and the pinned Node runtime. It records the source commit, lockfile digest, upstream registry locations, declared licenses and package integrity hashes when present. Reproducible metadata uses the source commit timestamp. It is not a claim that every dependency is included in each connector, and does not inventory Docker's OS packages; see [Docker distribution](docker.md) for that separate evidence.

For a public repository, the manual workflow first exports the exact verified CI assets without publishing them. A pinned GitHub attestation action signs those bytes. Final release validation independently downloads and rechecks the CI packages and requires valid attestations for every release asset, constrained to this repository, `release.yml`, `main`, the exact source/workflow commit and a GitHub-hosted runner. Attestation failure stops before draft creation or publication. This is provenance for the verified release promotion; the archive manifest and linked CI run identify the native builds. It is not a claim of a particular SLSA level or an operating-system signature.

Releases v0.1.0 and v0.2.0 were originally published while the repository was private. They are now publicly downloadable, with their original assets preserved, but have no GitHub artifact attestations. Use their published checksums, manifests and linked CI evidence. Changing visibility does not retroactively attest an existing release. Future releases created through the public workflow require attestations before publication.

For a release that includes GitHub attestations, verify an asset using an installed recent [GitHub CLI](https://cli.github.com/manual/gh_attestation_verify), replacing the filename and source commit with the values from the release:

```sh
gh attestation verify agile-project-ui-connectors-linux-x64.tar.gz \
  --repo enzovalley9/agile-project-ui \
  --signer-workflow enzovalley9/agile-project-ui/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --source-digest RELEASE_SOURCE_COMMIT \
  --signer-digest RELEASE_SOURCE_COMMIT \
  --deny-self-hosted-runners
```

GitHub Free supports [artifact attestations for public repositories](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations). Private repository attestations require Enterprise Cloud. The private workflow deliberately skips this paid/gated service and accurately says that no GitHub attestation was issued; checksums, manifests and exact CI provenance still apply. No visibility, plan or billing change occurs. A public release cannot opt out of attestation verification.

For maintainers preparing the public attestation step, `--check --export-verified-assets ABSOLUTE_NEW_DIRECTORY` writes only validated release assets to a new local directory. It does not change GitHub and does not establish signed provenance. The export option is rejected during publication, so it cannot bypass the attestation gate. Preserve the ordering in `.github/workflows/release.yml` and do not add `continue-on-error` to the attestation steps.

CI retains native candidate artifacts for three days to bound storage use. Publish within that window or rerun exact-source CI to obtain fresh verified artifacts. A green run whose artifacts expired is not a valid release source; already published GitHub release assets are independent of CI artifact retention.
