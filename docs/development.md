# Development

## Setup

Use the Node version in [`.node-version`](../.node-version) for parity with CI and npm with the committed lockfile. Git is needed for connector integration tests. Desktop Chrome or Edge is needed for the real directory picker.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The server uses a strict port; if it is occupied, stop your previous instance or deliberately change the configuration and every connector's exact origin. `localhost` and `127.0.0.1` are different browser origins.

Use synthetic fixtures or disposable copies for development. Do not connect live customer projects or provider accounts to automated tests.

## Commands

| Command                                 | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                           | Loopback Vite development server.                                    |
| `npm run typecheck`                     | TypeScript checks.                                                   |
| `npm test`                              | Unit/integration tests, including temporary native Git repositories. |
| `npm run test:watch`                    | Interactive Vitest runner.                                           |
| `npm run build`                         | Static web and bundled connectors.                                   |
| `npm run check`                         | Typecheck, tests and build.                                          |
| `npm run test:e2e`                      | Playwright journeys using real temporary disk fixtures.              |
| `npm run connector:git -- --help`       | Native Git connector arguments.                                      |
| `npm run connector:atlassian -- --help` | Jira/Confluence connector arguments.                                 |

For local production preview after building:

```sh
npx vite preview --config apps/web/vite.config.ts
```

Preview listens on `http://127.0.0.1:4173`. A connector started for development port 5173 must be restarted with the preview origin. Directory grants and private browser storage are origin-specific.

## Formatting and dependency notices

`npm run format` formats maintained source and documentation; `npm run format:check` checks without changing files. Original test fixtures and third-party legal text are deliberately excluded. Keep code, developer comments, maintained UI text and public documentation in English; project files, multilingual fixtures, protocol keys and original license text retain their original language.

After installing a dependency update with the lockfile, run `npm run notices`, review the generated inventory and complete license text, then run `npm run notices:check` and `npm run audit:dependencies`. An unknown license or missing notice fails generation and requires a documented review. The inventory is deliberately inclusive, not a claim that every package appears in every bundle.

Web builds copy the notices into `dist/web`; connector packaging includes them in the verified install manifest alongside the runtime license. The project LICENSE is copied when present. Until the project license is selected, build warnings make that unresolved distribution condition explicit. Do not redistribute a build as open source on the strength of dependency notices alone.

## Connector packages

```sh
npm run build:connectors
node scripts/package-connectors.mjs
node scripts/smoke-package.mjs
```

The package script uses `.node-version`, downloads the official platform archive, verifies its checksum and retains Node's license. Artifacts go to `dist/artifacts`. Building a target does not prove it runs there; CI provides native smoke evidence for its matrix targets.

Extract a trusted artifact and run `install.command` on macOS, `install.sh` on Linux, or `install.cmd` on Windows. The installer also accepts `--destination ABSOLUTE_DIRECTORY`. It verifies files in staging and preserves an existing installation. The included launcher accepts `git` or `atlassian`, followed by the documented connector arguments. Git itself is not bundled.

Installation does not request elevated privileges, register auto-start or start a listener. Stop a running connector with Ctrl+C. To uninstall, stop its processes and remove only its installed folder; project data is separate. A crash may leave an installer staging directory/lock beside the destination. Confirm no installer is running before removing only those leftovers. Do not delete Git locks to troubleshoot installation.

Packages are unsigned. Do not bypass OS security prompts on the basis of a checksum alone. Before redistributing a build, include the applicable project license and all dependency/runtime notices; see the release checklist below.

## Dependency and release changes

Keep `package-lock.json` synchronized with dependency changes. Review direct and transitive licenses, vulnerable-package reports and generated build notices. A clean vulnerability scan is not a security guarantee. Do not copy dependency code or assets without retaining applicable notices and provenance.

Before a public release:

1. Resolve the project license and distribution terms; source visibility alone does not grant open-source redistribution rights.
2. Review the exact tracked files and history for secrets, private research, personal data and unapproved assets. Rotating a leaked credential is separate from removing it from history.
3. Run the documented checks at the release commit, inspect all three package targets and both browser jobs, and retain artifact checksums/notices.
4. Establish a working confidential vulnerability-reporting route and verify its availability. A `SECURITY.md` file alone does not enable a reporting service.
5. Make an explicit visibility/release decision. Signing/notarization, hosted deployment and package-registry publication are separate operations.

README/community files, automated dependency updates, branch protection and release automation help maintain a project. They are not a substitute for a license or evidence that repository settings have actually been enabled.
