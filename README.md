# BMAD Project UI

A browser workspace for reading and editing BMAD Method project files, exploring stories and epics, and discussing specific passages. Project documents remain the source of truth. There is no authoritative application database.

The structured adapter targets **BMAD Method 6.12.0**. Unknown versions and formats retain generic reading with visible compatibility limits. The application does not run BMAD agents or workflows.

This repository is currently private and being prepared for an open-source release. **A project license has not yet been selected.** Documentation and contribution templates do not themselves grant reuse or redistribution rights. Third-party components retain their own licenses.

## Run locally

Use Node.js 24 LTS and npm. The tested packaging runtime is pinned in [`.node-version`](.node-version); the supported source-development range is declared in [`package.json`](package.json). Use desktop Chrome or Edge.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` and select your **project root**. The workspace starts in read mode. The edit-mode switch requests browser write permission. Use the theme control to choose a light or dark appearance; document content keeps its original language. No connector is needed to read, edit or comment on local documents.

For a disposable example, select [`tests/fixtures/huerto`](tests/fixtures/huerto) from this checkout. Copy it elsewhere before editing if you want to preserve the test fixture. Its documents are original synthetic test data; opening them does not require installing or running BMAD.

The production build writes static assets to `dist/web` and Node connectors to `dist/connectors`. Browser directory access requires HTTPS or localhost. The development and preview servers listen only on loopback.

## Workspace

- **Documents:** searchable file tree, rendered Markdown, source text, headings, relative links and local raster images. Remote images do not load automatically.
- **Work:** drag stories between supported states in Stories or Sprint when edit mode is enabled. Review the affected source files before confirming; the Move button provides the same action by keyboard. Epic details and the sprint show expandable story/task lists with completion markers. Sprint state, execution state and checklist completion keep their separate meanings.
- **Editing:** one draft shared by visual and source views. Structured changes show affected files before saving. Save, commit and push are separate actions.
- **Comments:** fragment threads, replies, reactions, edits to your own messages and resolution, stored in `.bmad-project-ui/comments/threads` outside `_bmad-output`.
- **Catalog and diagnostics:** read-only installation-defined agents, skills and workflows, plus unknown formats, ambiguous data, missing files and partial scan coverage.

Derived documents can be edited and commented on with a regeneration warning. Edits do not implicitly rewrite memlogs or invent states missing from the originals. Files containing unresolved merge markers are displayed as read-only source until you resolve them externally and reread the project.

| Content                                    | Support                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Markdown                                   | Rendered reading, source and editing. Active HTML is blocked.                                               |
| YAML, TOML, JSON, CSV, TXT, MDX, HTML, XML | UTF-8 source; structured projections only where an adapter exists. Templates and components do not execute. |
| PNG, JPEG, GIF, WebP                       | Markdown-referenced images inside authorized roots, up to 8 MiB. No image editing.                          |
| SVG, PDF and other attachments             | Excluded from the text inventory with diagnostics; not executed or edited.                                  |

Text scans are bounded to 2 MiB per file, 32 MiB per inventory, 5,000 files and 20 directory levels. A limit or read failure means partial coverage, not an empty project. Secret/tool/dependency paths and nested repositories are excluded.

## Optional connectors

### Native Git

The Git connector requires Git installed on your computer and uses its identity, signing, hooks and credential helpers. Its trust prompt matters: native repository configuration can run local programs.

Create a private directory outside the project, then start the connector:

```sh
mkdir -p "$HOME/.bmad-project-ui"
npm run connector:git -- \
  --repo /absolute/path/to/project \
  --origin http://127.0.0.1:5173 \
  --token-file "$HOME/.bmad-project-ui/git-session"
```

Load the generated local session file in the Git connection panel. It is not a GitHub token. The application verifies that browser and connector refer to the same folder, then offers explicit commit review, existing local branch switching and outgoing-history review before push. There is no force push, automatic pull or visual merge resolver. See the [Git guide](docs/git-connector.md).

### Jira and Confluence

Each provider uses an independent connector process, local session, credentials and selected scope. The browser verifies account/service identity before explicit resource linking. The implemented profiles support reading, bounded search, available history, field comparison, export proposals and reviewed local imports.

**Production remote writes are blocked** where the API cannot prove the required atomic update or draft-preservation guarantees. Mock atomic adapters test publication and recovery without claiming real-provider guarantees. No live Atlassian account was used in acceptance. See [profiles, setup and limitations](docs/atlassian-connectors.md).

Provider credentials belong in private connector files or environment variables, never in the browser or repository. Verified comparison bases use browser-private storage and are separate from versioned links; the UI identifies when only an in-memory base is available.

## Integrity and recovery

The browser checks file revisions before writing, before closing the stream and after saving. External changes retain your draft for review. Web Locks coordinate writes and Git operations between application tabs sharing an origin.

An incomplete write leaves a hash journal in `.bmad-project-ui/local/write-recovery.json` and blocks further mutations. Original/planned copies use browser-private storage when available. Recovery checks current bytes and preserves later external changes. Local journals are excluded from connector commits.

Unsaved drafts live in the current tab. Export them before closing if needed. Clearing browser/profile/origin storage can remove private recovery copies. External editors do not participate in Web Locks; these checks are not a universal filesystem transaction. Comment identity is locally declared, not team authentication.

## Develop and test

```sh
npm run check
npm run format:check
npm run notices:check
npm run audit:dependencies
npx playwright install chromium
npm run test:e2e
```

[`CONTRIBUTING.md`](CONTRIBUTING.md), the [development guide](docs/development.md), [architecture](docs/architecture.md) and [testing guide](docs/testing.md) explain the module boundaries and expected evidence. CI checks macOS, Linux and Windows and runs browser journeys in Chromium and Edge. See [support](SUPPORT.md) for troubleshooting and [security reporting](SECURITY.md) for sensitive issues.

## Bundled connector runtime

```sh
npm run build:connectors
node scripts/package-connectors.mjs
node scripts/smoke-package.mjs
```

Packaging downloads the pinned official Node runtime and checks its SHA-256. It builds for the selected platform/architecture. CI installs and starts the packages on macOS, Windows and Linux. Installation verifies files in a staging directory and does not start services automatically.

These are private CI artifacts, **unsigned and not notarized**. Checksums detect corruption; they do not establish publisher identity. The [development guide](docs/development.md#connector-packages) describes installation and removal. Public releases, signing and hosting have not been established.

## Third-party notices

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) retains the locked production dependency and build-helper notices, including mixed Lucide/Feather attribution. `npm run notices` regenerates it after dependency changes; CI rejects stale or unreviewed notices. Web builds and connector archives include this file. Connector archives also retain Node's complete upstream license at `runtime/LICENSE`. These notices do not grant a first-party project license.
