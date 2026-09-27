# Releases and distribution

## Access

[GitHub Releases](https://github.com/enzovalley9/agile-project-ui/releases) contains versioned connector packages and release notes. The repository and its releases are currently private: sign in to an account with repository access to download them. A public frontend URL does not grant GitHub repository or release access. A 404 from GitHub can indicate missing access as well as a missing release.

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

Stop every running connector before updating. Preserve its private session/credential directory and any unresolved operation journals. Extract the new release separately and follow its installation instructions; the installer does not overwrite an existing installation automatically. Use `--destination ABSOLUTE_DIRECTORY` for a separate installation, verify it, and only then remove an obsolete installed folder you no longer need.

To uninstall, stop the connector processes and remove the specific installed package folder. Project documents and separately stored credentials/journals are not part of that folder. Removing an application package does not resolve an uncertain Git or provider operation.

## Reproduce a build

A release should identify its exact source tag/commit and passing CI run. With source access, check out that revision, use the pinned Node runtime, install the committed lockfile with `npm ci`, and run the [documented checks](testing.md).

```sh
npm run build
node scripts/package-connectors.mjs
node scripts/smoke-package.mjs
```

Packaging fetches the pinned official Node runtime and verifies its upstream SHA-256. Native CI checks the installed runtime on its actual operating system; merely producing a cross-platform archive does not prove it runs on that target. Connector smoke tests and live provider account acceptance are separate.

See [CHANGELOG.md](../CHANGELOG.md) for user-visible changes and the [development release checklist](development.md#dependency-and-release-changes) for maintainer responsibilities.

## Maintainer release workflow

1. Update the package version and its matching changelog section, complete the documented checks, then push the reviewed commit to `main`.
2. Wait for **Verify application and connectors** to pass all six jobs at that exact commit, including the static frontend/local connector journey.
3. Run **Release verified connector packages** through GitHub Actions' manual workflow dispatch on `main`.
4. The workflow validates the three native CI packages and their provenance, creates a draft, uploads the archives and checksums, and verifies their remote hashes before publishing the release. Inspect the workflow result and release assets before sharing the link.

The current workflow requires a private repository and never changes visibility. It rejects an existing release, a conflicting tag, incomplete CI, or a changed `main` revision. Publishing an existing version is not a retry mechanism. If an operation fails or has an uncertain outcome, inspect the retained draft/release before choosing a recovery; do not delete or replace it blindly. Public-repository releases require an explicit future change to this private-release policy.

The initial native release matrix is macOS ARM64, Linux x64 and Windows x64. Other source-supported architectures are not advertised as tested release downloads.
