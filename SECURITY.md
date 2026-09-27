# Security

## Reporting a vulnerability

Do not post exploit details, capabilities, provider credentials or private project content in a public issue or pull request.

Email **Enzo Valley** at [enzovalley9@gmail.com](mailto:enzovalley9@gmail.com) with a subject beginning with `Security report`. This contact is available regardless of GitHub repository access. Do not use a general issue for sensitive details, even when the repository itself is private.

GitHub issue and advisory URLs for this repository are not anonymous reporting channels while repository access is restricted. This policy does not promise that GitHub's **Report a vulnerability** form is available.

Include the affected commit/version, component, OS/browser, a minimal synthetic reproduction, observed impact and any proposed mitigation. Remove tokens, personal data and real project documents. Report only systems you are authorized to test.

The latest released 0.x version is the maintenance target. There is no long-term support branch, published vulnerability-response SLA or bug bounty. Include the exact affected revision so maintainers can reproduce it; a version number alone is not proof that a fix exists.

## Security model

- Browser folder permission and connector authorization are separate. Connectors listen on loopback, check exact origins/hosts and require local capabilities.
- Git repository trust permits native hooks, filters, signing programs and credential helpers. A folder grant is not a sandbox for those programs.
- Provider credentials remain outside the browser/project. Jira and Confluence cannot read project files or execute Git.
- Markdown is treated as untrusted content. Active HTML and automatic remote image loading are blocked. Local text/image reads have scope and size limits.
- File writes verify revisions and preserve recovery evidence. External editors remain outside application Web Locks; no universal filesystem transaction is promised.
- Comment identity is self-declared local identity, not authentication or access control for a team.

See [architecture](docs/architecture.md) and the [connector guides](docs/git-connector.md) for detailed boundaries. Known secret-path filtering is not a complete secret scanner. Checksums establish file integrity, not publisher identity; current packaged runtimes are unsigned.

## Container vulnerability policy

Publication and scheduled scans reject every unreviewed HIGH or CRITICAL finding, including vulnerabilities without a vendor fix. A reviewed disposition must match the exact CVE, package version, architecture and severity, cite primary evidence and expire within 30 days. Runtime checks enforce its prerequisites; raw findings remain in the retained report. The separately compiled OpenSSH client has an additional version, binary identity and time-limited upstream review requirement.

A passing gate is not a claim of zero vulnerabilities. Dispositions apply to the supplied non-root image and supported application routes; arbitrary repository hooks or a modified/privileged container can invalidate them. See the [distribution security policy](docs/supply-chain.md#security-maintenance) for the checks and maintenance procedure.
