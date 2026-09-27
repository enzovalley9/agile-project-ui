# Changelog

Changes are grouped by release. This project is in its early 0.x series; review release notes before updating connector installations or relying on provider-specific behavior.

## 0.2.0

Public-beta readiness release. The source repository remains private until its owner authorizes a public transition; the hosted application and container remain available independently.

### Added

- Read-only in-browser demo, downloadable original MIT example ZIP, and local text-folder import for browsers without writable folder access.
- Three-step onboarding, explicit beta/browser/feature support matrix, privacy guide, roadmap, maintainer policy and contribution starter issues.
- Maintained screenshots in the anonymous public help site.
- Connector version/protocol negotiation before authenticated requests, installed-version display, guided setup and preflight diagnostics.
- Explicit verified connector update and rollback with preserved previous packages and external state.
- Linux ARM64, macOS Intel and Windows ARM64 native CI/package targets alongside the original three platforms.
- Native source SPDX inventory, container CycloneDX inventories, exact Debian/Node corresponding sources and complete retained notices in the image.
- Weekly dependency/container scans, Dependabot configuration, container signatures/provenance and an explicit future-public GitHub protection setup.

### Fixed

- Release validation now checks the real CI workflow contract, including Docker and every supported native target.
- Release automation supports an explicit expected private or public repository policy without changing visibility; public publication requires verified build attestations.
- Native archive ownership and permission headers are normalized across build platforms.

### Limits

- The full original-folder edit/Git workflow still requires desktop Chrome or Edge. Imported snapshots are read-only; physical mobile folder-picking behavior is device-specific.
- Jira/Confluence production remote writes remain blocked and no live tenant acceptance is claimed.
- Native archives remain unsigned and unnotarized; signing prerequisites are documented. Private GitHub attestations/security features can require a paid plan and are not enabled implicitly.
- Independent human usability studies and anonymous source/release/fork acceptance require participants or a separately authorized public repository transition.

## 0.1.0

Initial release of Agile Project UI, a local-first workspace for documents, stories and sprints. Compatible with BMAD Method.

### Added

- Browser workspace for local project documents, including Markdown rendering, source editing and file diagnostics.
- BMAD Method 6.12.0 adapter for documents, stories, epics, sprint state and task lists with source provenance.
- Reviewed story moves by drag and drop or keyboard in editor mode.
- Fragment comments, replies, reactions and resolution in versionable sidecar files.
- Light, dark and system themes and an explicit read/edit switch.
- Optional native Git connector with folder binding, repository trust, reviewed commits, branch changes, pushes and reconciliation.
- Independent Jira and Confluence connectors for linking, reading, comparison and reviewed local imports.
- Bundled connector runtime packages and setup guides for macOS, Windows and Linux.
- Unit, integration, browser and installed-package checks, English synthetic examples and MIT licensing.

### Known limits

- The local-folder workflow requires desktop Chrome or Microsoft Edge on HTTPS or localhost.
- Jira and Confluence production remote writes are blocked; publication/recovery tests use mocks, and no live tenant acceptance is claimed.
- Connector archives are unsigned and not notarized. Git is installed separately.
- Local drafts and auxiliary browser storage have the lifetimes described in the README; browser locks do not coordinate arbitrary external editors.
- GitHub source and release access remain restricted to repository collaborators until the owner chooses to make the repository public.
