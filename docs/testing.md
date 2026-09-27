# Testing

## Automated checks

```sh
npm run check
npm run format:check
npm run notices:check
npm run audit:dependencies
npx playwright install chromium
npm run test:e2e
```

CI runs typecheck, unit/integration tests, builds and installed-runtime smoke on macOS, Ubuntu and Windows. Browser jobs run the Playwright journeys in Chromium and Microsoft Edge. CI fails on flaky tests even if a retry passes; retries retain diagnostic evidence.

To run the Edge browser locally after installing it for Playwright:

```sh
npx playwright install msedge
AGILE_PROJECT_UI_E2E_CHANNEL=msedge npm run test:e2e
```

That environment assignment is POSIX shell syntax. In PowerShell, set `$env:AGILE_PROJECT_UI_E2E_CHANNEL='msedge'`, run the command, then remove the variable if it should not affect later runs. Browser installation can require system dependencies; CI uses Playwright's `--with-deps` option.

The repository-hygiene CI job also verifies deterministic notices, formatting, dependency vulnerability reports and reachable-history secret scanning. These are checks of known patterns and reported vulnerabilities, not proof of the absence of all security defects.

`tests/e2e/ux-refinement.spec.ts` covers drag review/cancellation, exact persisted source changes, external-change rejection, epic/sprint task lists, keyboard alternatives, theme persistence, responsive geometry and automated contrast/accessibility checks in both themes. These supplement manual visual inspection.

## Evidence boundaries

| Layer                   | What it proves                                                                                                      | What it does not prove                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Domain/comments tests   | Parsing, provenance, schema validation, exact source changes, anchors and reactions.                                | Every BMAD fork or original document shape.                          |
| Browser-store tests     | Revision/permission logic, recovery and injected write/race failures.                                               | Native browser permission prompts or every filesystem.               |
| Git integration tests   | Native temporary repositories, exact commits, selected-index preservation, outgoing history and local bare remotes. | A user's credential manager or remote provider account.              |
| Atlassian tests         | Adapter/HTTP contracts, safe capabilities, comparison/import and mocked atomic publication/recovery.                | Real tenant authentication, workflows or API concurrency guarantees. |
| Playwright journeys     | Actual UI interaction plus real temporary disk files, two-tab races, recovery and connector roundtrips.             | The native directory picker: the test driver substitutes it.         |
| Installed-package smoke | Verified install, actual bundled service startup, Git session/root binding, Jira health/auth boundary and shutdown. | Signing/notarization or a live Jira tenant.                          |

Three native Git cases are skipped on Windows: creating a file symlink without additional privileges, a combined filename case containing a newline and metacharacters, and a literal `:(glob)*` filename. macOS/Linux execute them. Do not describe those skips as passing Windows coverage.

## Native-browser acceptance

For changes to permissions, file access or rendering, supplement automation with a disposable project in actual desktop Chrome or Edge:

1. Use the native picker to open the intended folder; verify read mode and its displayed files.
2. Grant editor permission, edit one document and independently compare its on-disk bytes.
3. Select a rendered Unicode fragment, comment/reply/react, reload the page and reopen the folder. Confirm the sidecar and unchanged document.
4. Exercise native browser zoom, narrow layout and keyboard focus for the changed UI.
5. If Git changed, review a one-file commit and outgoing history, then verify the exact local/remote SHA using an authorized disposable remote. Do not substitute an HTTP success message for that comparison.

Record source revision, browser/version, OS, steps, screenshots where useful, and limitations. Use synthetic documents and redact local capabilities/provider credentials. Do not commit private project exports or browser reports containing sensitive data.

## Focused regression work

Prefer a minimal reproduction for a defect and assert the resulting behavior, not internal implementation details. For write/recovery changes, verify original bytes, external edits, the retained draft and journal state. For an indeterminate connector outcome, verify reconciliation without replay.

Tests must own their temporary files, ports and processes and release them in cleanup. A timeout after the last assertion can still be a fixture failure. Investigate traces and logs before changing timeouts. Do not remove assertions or accept retries solely to make CI green.

Playwright stores its HTML report in `playwright-report` and failure evidence in `test-results`; these outputs are ignored by Git. Capture durable, sanitized evidence separately when needed. The fixture directory is synthetic and can be reused without installing BMAD or executing its agents.
