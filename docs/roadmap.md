# Roadmap

This is a small maintainer-led public beta. The [support matrix](compatibility.md) defines shipped behavior; this roadmap is not a delivery-date promise. Discuss substantial changes before implementing them and use original synthetic projects in tests.

## Current focus

- Reproducible installation, compatible connector updates and recovery on supported desktop platforms.
- Small, accessible first-use journeys and read-only access beyond desktop Chromium browsers.
- Exact-source releases, dependency/container updates, preserved license/source obligations and useful diagnostics.
- Clear evidence for BMAD Method format compatibility and honest provider capabilities.

## Next evidence we need

- Independent first-use sessions on macOS, Windows and Linux: where people hesitate, fail or misunderstand save/commit/push.
- Consenting maintainers with real Jira/Confluence test tenants to validate read/import behavior and investigate safe conditional remote writes. No production writes until the required guarantees are established.
- Native signing/notarization identities and a maintainable funding/ownership decision, followed by actual OS trust acceptance. Checksums are already available but are not code signing.

## Starter contributions

- [Add one original minimal fixture](https://github.com/enzovalley9/agile-project-ui/issues/1) for a currently unsupported BMAD document layout, its expected diagnostic/provenance, and a failing test before proposing parser changes.
- [Test the read-only demo](https://github.com/enzovalley9/agile-project-ui/issues/2) with keyboard and a screen reader; report a reproducible focus or announcement issue with exact browser/OS.
- [Improve one installation troubleshooting case](https://github.com/enzovalley9/agile-project-ui/issues/3) using a clean environment and sanitized commands/output. Do not add telemetry or collect private files.

Search existing [issues](https://github.com/enzovalley9/agile-project-ui/issues) before opening a new one. Follow [CONTRIBUTING](../CONTRIBUTING.md). GitHub access depends on repository visibility; [email](mailto:enzovalley9@gmail.com) remains available. Hosted accounts, team authentication, agent execution and a full merge editor are outside the current scope.
