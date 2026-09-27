# Maintainer guide

Enzo Valley (`@enzovalley9`) currently owns maintenance and review; see [CODEOWNERS](../.github/CODEOWNERS). Contributions stay under MIT as described in [CONTRIBUTING](../CONTRIBUTING.md). No CLA, automatic merge, paid support commitment or additional discussion channel is required. Use issues for ordinary work and the private security contact for sensitive reports.

## Repository safeguards

With an authenticated administrator's GitHub CLI, preview the settings for the repository's **current** visibility:

```sh
node scripts/configure-github.mjs --repo enzovalley9/agile-project-ui --expected-visibility private
```

Add `--apply` to enable dependency alerts/security-update PRs, maintained topics and merged-branch cleanup. The command checks repository identity and expected visibility before each change. It never changes visibility or enables a paid security product. Dependabot opens weekly npm, Actions and Docker update PRs; tests and maintainer review remain mandatory.

After the owner separately authorizes and performs a public transition, use the same command with `--expected-visibility public`, review its plan, then add `--apply`. The public policy prepares:

- Required current release CI checks from GitHub Actions and up-to-date pull requests; no deletion or force push of `main`, including administrators.
- A pull-request review surface with zero mandatory approvals for the initial solo maintainer. Existing stronger requirements are preserved. A maintainer's own PR can pass CI without needing a second person; contributions still receive manual review.
- Immutable `v*` tags: no updates or deletions and no routine bypass. Release creation remains allowed. Never replace a published asset/tag to fix a release.
- Secret scanning and push protection, private vulnerability reporting, and CodeQL default setup where available for a public Free repository.

The command verifies settings by reading them back. Readiness is not established by a successful request alone: wait for CodeQL's first successful analysis and inspect GitHub's settings/alerts. If a provider rejects a setting, resolve it explicitly; do not downgrade protections silently. GitHub gates some controls for private Free repositories, so they cannot be described as active before a verified public activation or an existing paid plan. No plan upgrade is performed.

Sources: [GitHub protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [repository security settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository), and [dependency update options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

## Release and rollback

Follow [releases](releases.md) and [hosting](hosting.md). Release from an exact green source revision, verify all artifact hashes/platforms, and align native packages, the container and hosted `/version.json`. Retain previous immutable versions for rollback. Do not overwrite published artifacts. Connectors negotiate their protocol before connecting; updates never silently delete project/state files.

Private GitHub Actions runs consume the account's included minutes/storage and may incur configured overage. Public standard runners are free; no statement here certifies the owner's remaining private quota. Check billing limits before expensive reruns; never enable paid runners or a paid security plan implicitly.

## Clean first-use study

The automated example, native installer and browser journeys provide reproducible checks. They do not replace people using the product without coaching. Recruit consenting testers separately; do not collect real documents or credentials.

Give each tester only the public app URL and ask them to: explore the demo; obtain/extract the example; edit/save a note and verify it outside the browser; move a story; install/preflight/connect Git; commit; stop/restart; update and roll back. Use a disposable local repository and no required remote push. Ask them to describe what they expect before each save/commit/push.

Record OS/CPU/browser, exact source/version, task success without help, steps/time, first confusing instruction, permission errors, recoverability and accessibility feedback. Do not record tokens, paths with personal data or screen content without consent. A finding becomes a minimal synthetic issue and a focused regression where appropriate. Keep unperformed participant sessions marked **not run**.

## Final public-access acceptance

When visibility is authorized, use a logged-out clean environment to clone the source, download and verify every advertised release target, pull the container, open public help/images/example, and follow CONTRIBUTING with a real fork and pull request. Check issue forms and private vulnerability reporting independently. Keep the separate planning/documentation repository private. An authenticated private clone, mock API or local green build does not prove anonymous public access.
