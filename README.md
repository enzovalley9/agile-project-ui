# BMAD Project UI

Read, edit and discuss your BMAD Method project in a browser. Browse documents, move stories, inspect epic and sprint tasks, and keep every change in the project's files.

[MIT license](LICENSE) · [Releases](https://github.com/enzovalley9/bmad-project-ui/releases) · [CI](https://github.com/enzovalley9/bmad-project-ui/actions/workflows/ci.yml) · [Contributing](CONTRIBUTING.md)

The application is independent of BMad Code, LLC. It does not run BMAD agents or workflows. Its structured adapter targets **BMAD Method 6.12.0**; other versions retain generic reading with visible compatibility limits.

## Features

- **Documents:** searchable file tree, Markdown rendering, source editing, headings, relative links and local images.
- **Work:** story boards, epic details and sprint views with expandable task lists. Move stories by drag and drop or keyboard, then review the source changes before saving.
- **Discussion:** comments on text fragments, replies, reactions and resolved threads, saved in versionable sidecar files.
- **Appearance:** light, dark and system themes, with a separate switch for read and edit modes.
- **Native Git:** optional local connector for reviewed commits, existing-branch changes and pushes. Save, commit and push remain separate actions.
- **Jira and Confluence:** independent optional connectors for linking, reading, comparing and reviewed local imports, with explicit provider limits.

## Quick start

Use desktop **Chrome or Microsoft Edge**. The application needs the browser's directory-access API and a secure origin: HTTPS or localhost. Firefox, Safari and mobile browsers are not supported for the complete local-folder workflow.

For local development, install **Node.js 24 LTS**, npm and Git. [`.node-version`](.node-version) pins the tested runtime.

```sh
git clone https://github.com/enzovalley9/bmad-project-ui.git
cd bmad-project-ui
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**, select your project root and start reading. Turn on edit mode when you want to save changes; the browser will request write permission. No connector is needed to read, edit or comment on local documents.

For a disposable example, copy [`tests/fixtures/community-garden`](tests/fixtures/community-garden) outside the checkout and open the copy. It contains original synthetic planning documents, stories, epics, a sprint and comments. Installing or running BMAD is unnecessary to open it.

The GitHub repository and release downloads currently require repository access. MIT grants rights to copies you receive; it does not grant access to a private repository. See [release access and verification](docs/releases.md).

## Your files stay in your project

The frontend runs in your browser. The hosting service delivers the application's static files; it does not receive the project you select. There is no account requirement, hosted project database or background synchronization.

- Documents and task states remain authoritative in their original files.
- Comments live in `.bmad-project-ui/comments/threads`, outside `_bmad-output`.
- Browser-private storage holds auxiliary recovery copies and verified comparison bases. Theme preferences are local to the browser.
- Optional connectors run on your computer. Git uses your installed Git; Jira and Confluence contact their configured providers with credentials kept outside the browser and project.

Rendered documents block active HTML and do not automatically load remote images. The browser checks source revisions before writing and verifies the result. External changes retain your draft for review. A partial write blocks further mutations until recovery is resolved.

Unsaved drafts live in the current tab. Export them before closing if needed. Clearing browser storage can remove recovery copies. Browser locks coordinate app tabs, not arbitrary external editors. Comment identity is locally declared; it is not team authentication.

See [architecture and data boundaries](docs/architecture.md) and the [security policy](SECURITY.md).

## Optional connectors

[Download connector packages](https://github.com/enzovalley9/bmad-project-ui/releases) and follow the [step-by-step setup guide](docs/connector-setup.md). The same instructions are available from each connection panel. Packages bundle Node.js for supported macOS, Windows and Linux targets; Git must be installed separately.

| Connector  | What it accesses                                                         | Current behavior                                                                                                                           |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Git        | One explicitly bound local repository and your native Git configuration. | Review and verify commits, changes to existing local branches and outgoing pushes. No force push, automatic pull or visual merge resolver. |
| Jira       | Your configured Jira instance and selected project.                      | Read, link, compare, prepare exports and review local imports. Production remote writes are blocked.                                       |
| Confluence | Your configured Confluence instance and selected space.                  | Read, link, compare, prepare exports and review local imports. Production remote writes are blocked.                                       |

Jira and Confluence do not read project files or run Git. Production writes remain blocked where an adapter cannot establish the required atomic update or draft-preservation guarantees. Mock providers exercise publication and recovery; they do not establish live tenant compatibility. No live Atlassian account was used for acceptance.

Git repository trust permits native hooks, filters, signing tools and credential helpers. Only trust repositories and native programs you intend to run. Packages are **unsigned and not notarized**; checksums verify integrity, not publisher identity.

Details: [Git](docs/git-connector.md) · [Jira and Confluence](docs/atlassian-connectors.md).

## Compatibility and limits

| Content                                    | Support                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Markdown                                   | Rendered reading, source editing and comments. Active HTML is blocked.                                       |
| YAML, TOML, JSON, CSV, TXT, MDX, HTML, XML | UTF-8 source. Structured views appear only where an adapter exists; templates and components do not execute. |
| PNG, JPEG, GIF, WebP                       | Markdown-referenced local images within authorized roots, up to 8 MiB.                                       |
| SVG, PDF and other attachments             | Excluded from the text inventory with diagnostics; not executed or edited.                                   |

Text scans are bounded to 2 MiB per file, 32 MiB per inventory, 5,000 files and 20 directory levels. Limits, read failures, unknown formats and ambiguous work items are reported as diagnostics. Secret, tool and dependency paths and nested repositories are excluded. These exclusions are not a complete secret scanner.

Derived documents can be edited with a regeneration warning. Changes do not silently rewrite memlogs or invent states. Files with unresolved merge markers remain read-only source until resolved externally.

## Build and test

```sh
npm run check
npm run format:check
npm run notices:check
npm run audit:dependencies
npx playwright install chromium
npm run test:e2e
```

The build writes the static application to `dist/web` and Node connectors to `dist/connectors`. CI checks macOS, Linux and Windows, including installed connector packages, and runs browser journeys in Chromium and Edge. The [testing guide](docs/testing.md) separates automated fixtures, native browser acceptance and live-provider evidence.

For a local production preview after building:

```sh
npx vite preview --config apps/web/vite.config.ts
```

Open **http://127.0.0.1:4173**. Restart any connector with this exact origin; browser permissions and private storage are origin-specific.

## Contributing and support

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/development.md) and the [code of conduct](CODE_OF_CONDUCT.md). Maintained code, comments, documentation and examples use English. The application preserves the original language of users' files and includes deliberate Unicode regression coverage.

Use [SUPPORT.md](SUPPORT.md) for troubleshooting and sanitized bug reports. Report vulnerabilities through the route described in [SECURITY.md](SECURITY.md), not a public issue. Release changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License and attribution

First-party code, documentation and synthetic examples are available under the **[MIT License](LICENSE)**, copyright 2026 Victor del Valle. Preserve the copyright and permission notice when redistributing copies or substantial portions.

Dependencies retain their own licenses. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) contains the locked dependency notices, including Lucide/Feather attribution. Web builds and connector archives include the project license and these notices; connector packages also retain Node's license at `runtime/LICENSE`.

BMad and BMad Method are trademarks of BMad Code, LLC. This project's MIT license does not grant rights to third-party names, logos or branding. See the upstream [trademark guidelines](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/TRADEMARK.md).
