# Changelog

Changes are grouped by release. This project is in its early 0.x series; review release notes before updating connector installations or relying on provider-specific behavior.

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
