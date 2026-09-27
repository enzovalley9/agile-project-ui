# Security

## Reporting a vulnerability

Do not post exploit details, capabilities, provider credentials or private project content in a public issue or pull request.

This repository is currently private. Collaborators should contact the repository owner through the existing private channel used for their access. A dedicated public confidential reporting route has not yet been established.

If the repository later provides GitHub's **Report a vulnerability** action under Security → Advisories, use that private form. Its availability must be checked; this document does not enable it. If no confidential route is available, request one in an issue containing only the request for private contact, with no vulnerability details. Public release preparation must resolve this reporting route before inviting security reports.

Include the affected commit/version, component, OS/browser, a minimal synthetic reproduction, observed impact and any proposed mitigation. Remove tokens, personal data and real project documents. Report only systems you are authorized to test.

There is no published vulnerability-response SLA, bug bounty or maintenance schedule for older versions. Include the exact affected revision so maintainers can reproduce it; a version number alone is not proof that a fix exists.

## Security model

- Browser folder permission and connector authorization are separate. Connectors listen on loopback, check exact origins/hosts and require local capabilities.
- Git repository trust permits native hooks, filters, signing programs and credential helpers. A folder grant is not a sandbox for those programs.
- Provider credentials remain outside the browser/project. Jira and Confluence cannot read project files or execute Git.
- Markdown is treated as untrusted content. Active HTML and automatic remote image loading are blocked. Local text/image reads have scope and size limits.
- File writes verify revisions and preserve recovery evidence. External editors remain outside application Web Locks; no universal filesystem transaction is promised.
- Comment identity is self-declared local identity, not authentication or access control for a team.

See [architecture](docs/architecture.md) and the [connector guides](docs/git-connector.md) for detailed boundaries. Known secret-path filtering is not a complete secret scanner. Checksums establish file integrity, not publisher identity; current packaged runtimes are unsigned.
