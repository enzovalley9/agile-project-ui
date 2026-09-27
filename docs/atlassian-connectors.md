# Jira and Confluence connectors

The application connects to Jira and Confluence through two independent local processes. Neither process reads project files or runs Git. The browser retains responsibility for mapping local documents, reviewing changes and saving imports through the selected directory handle.

## Supported profiles and current limits

| Profile | Available | Remote writes |
| --- | --- | --- |
| Jira Cloud REST v3 | Account identity, projects, bounded issue search, immutable issue IDs, summary, ADF description, current status, transitions, changelog, comparison, import proposal and export | Blocked: this adapter has no verified atomic update precondition. An `updated` timestamp plus a preflight GET does not close the subsequent race. |
| Confluence Cloud REST v2, v1 current-user identity | Account identity, spaces, bounded exact-title page search, immutable page IDs, ADF body, page version, version history, comparison, import proposal and export | Blocked: current-page version checks do not prove that an unpublished draft is preserved. |
| Jira Data Center REST v2 read profile | Identity, projects, issue search, title/status read and comparison. Wiki body remains opaque. | Blocked. No server-version compatibility certification or body conversion. |
| Confluence Data Center REST v1 read profile | Identity, spaces, exact-title page search, title read and comparison. Storage body remains opaque. | Blocked. No server-version compatibility certification or body conversion. |

All capabilities come from the adapter. The browser cannot opt into an unsafe production write. A test-only injected adapter demonstrates atomic update, partial outcomes, journal recovery and reconciliation; its success does not certify Jira or Confluence.

Jira uses a separate transition operation, and fields can require workflow-specific metadata. The adapter does not bypass screen or workflow restrictions. See Atlassian's [issue operations](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/). Cloud description content uses [ADF](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/).

Confluence's [page update reference](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-put) describes reconciliation of current content with drafts. The connector deliberately records `draft: unknown` when it has only observed the published page. Published content is never evidence that a draft is absent.

These are implemented REST clients with HTTP mock coverage. No live Atlassian account was available for this delivery. OAuth app registration, consent and refresh-token distribution are not implemented; this local adapter uses credentials supplied privately by its operator. Cloud and Data Center APIs are separate profiles, not interchangeable guarantees.

## Start a connector

Use the runtime included in a packaged connector, or Node 24–26 in a source checkout. An instance is an exact HTTPS base URL without query, fragment or credentials. Cloud examples use the site origin; a Data Center instance may include its deployment context path.

```sh
npm run connector:atlassian -- \
  --provider jira \
  --deployment cloud \
  --instance https://example.atlassian.net \
  --origin http://localhost:5173 \
  --token-file "$HOME/.bmad-project-ui/jira-capability" \
  --credentials-file "$HOME/.bmad-project-ui/jira-credentials.json"
```

For Confluence use `--provider confluence` with a different capability file and credential file. Default ports are Jira `43121` and Confluence `43122`; `--port` overrides the port. The listener binds only `127.0.0.1`. Configure the browser with that exact address; `localhost` is not an accepted HTTP Host alias.

The capability file is generated if absent, with mode `0600`. Load this local file in the browser connection wizard. It authorizes the browser to the connector and is distinct from the provider credentials. Never paste a Jira/Confluence API token into the browser capability input.

A credentials file must be a private regular file (mode `0600` on POSIX), contain exactly one of the following forms, and remain outside the project:

```json
{"email":"operator@example.com","apiToken":"REPLACE_LOCALLY"}
```

```json
{"bearerToken":"REPLACE_LOCALLY"}
```

```json
{"authorization":"REPLACE_WITH_A_PROVIDER_SUPPORTED_AUTHORIZATION_HEADER"}
```

The connector can instead use `BMAD_ATLASSIAN_BEARER_TOKEN`, or the pair `BMAD_ATLASSIAN_EMAIL` and `BMAD_ATLASSIAN_API_TOKEN`. Their suitability depends on the selected provider, deployment and credential type. Provider authorization never appears in API responses, project metadata, operation journals or startup logs. This implementation does not provision credentials or manage provider MFA.

On Windows, protect these files and their parent directory using the operator's account ACL; POSIX mode checks cannot prove Windows ACL isolation. No Windows or Linux installation was exercised by the connector tests.

## Connection and review flow

1. Start the selected connector with the exact UI origin and instance.
2. Load its local capability file in the corresponding Jira or Confluence wizard.
3. The connector authenticates an independent provider current-user request, then the browser selects and checks a remote project or space and a local folder.
4. Search, inspect and explicitly link an existing resource. The link records instance plus immutable remote ID, scope, local path/entity and selected fields. A Jira key alone is not identity.
5. Compare selected fields. For a document mapping, a leading H1 is excluded from managed body only when it exactly matches the explicit local title; entity descriptions are preserved intact. A comparison is read-only and does not establish a common base merely because a link exists. Bodies use versioned canonical Markdown/ADF nodes; raw text hashes are not semantic equality.
6. Review the proposed import/export. Imports remain local and require browser revision validation. The connector returns body content separately from title/status, with no local frontmatter. The browser's appropriate BMAD editor owns field placement.

Supported portable body constructs include paragraphs, headings, lists, block quotes, rules, fenced code, basic tables and safe text/link marks. Images, attachments, mentions, macros, cards, HTML, task lists, table layout and other unsupported attributes produce partial coverage. A round-trip check catches content the Markdown serializer cannot preserve. Such body writes/imports are blocked; unsupported data is never silently discarded to claim equality. Selecting only a comparable title does not require replacing a partially comparable body.

No operation creates or deletes remote resources, uploads attachments, copies local comments, invokes an agent or synchronizes an entire folder. There is no arbitrary URL proxy.

## HTTP protocol v1

Every authenticated request needs the exact configured `Origin`, `Host: 127.0.0.1:<port>` and `Authorization: Bearer <sessionToken>`. Session creation uses the launcher capability instead. POST bodies use JSON. Request bodies are limited to 1.2 MiB and individual local text to 1 MiB; provider responses are limited to 2 MiB. Errors are `{ "error": { "code": "...", "message": "..." } }`. Error messages never echo provider response bodies or authorization.

| Method and path | Result or request |
| --- | --- |
| `GET /v1/health` | Minimal provider identity and `protocolVersion: 1`; no account or scope proof. |
| `POST /v1/session` | `{}`; returns session token, expiry, instance, adapter capabilities and verified account identity. |
| `DELETE /v1/session` | Revokes the session and its unexecuted plans. |
| `GET /v1/capabilities` | Adapter guarantees and production write-block reasons. |
| `GET /v1/scopes` | `{items,complete,warnings}` for projects or spaces. |
| `GET /v1/search?scope=…&q=…` | Bounded candidate list. Jira uses escaped JQL; Confluence uses an exact page title when provided. |
| `GET /v1/resources/:id` | Immutable identity, selected source fields, representation coverage, scope, observed version and provenance. |
| `GET /v1/resources/:id/history` | Bounded provider history; incomplete coverage is explicit. |
| `POST /v1/plans` | `{resourceId,scopeId,local:{path,revision,text,title?,status?,entityId?},base?,direction,fields,transitionId?}`. Revision is the browser's SHA256. |
| `POST /v1/operations` | `{planId}` only. Production remote updates are currently rejected. Imports are applied by the browser. |
| `GET /v1/operations` | Up to 20 operation records, unresolved first, for reload/reconnect recovery. |
| `GET /v1/operations/by-plan/:planId` | Recover a recorded operation after losing the initial response. |
| `GET /v1/operations/:id` | Read current recorded outcome. |
| `POST /v1/operations/:id/reconcile` | Re-read remote state and compare reviewed fields; never resends the update. |

Typed public shapes live in `packages/integrations/src/types.ts`. `createAtlassianApp`, `createAdapter` and `ProviderTransport` are exported for integration tests. HTTP provider instances are allowed only through the explicit programmatic loopback-test option; the production CLI has no HTTP or unsafe-write switch.

Session expiry defaults to 30 minutes; reviewed plans expire after five minutes. Plans bind local path/revision, selected fields, remote instance/ID/scope/version and the exact candidate hash. An expired, modified or foreign-session plan is rejected. Provider redirects are never followed. Safe reads retry transient responses at most once; an update is never blindly retried.

## Recovery and private data

Operation journals default to `~/.bmad-project-ui/atlassian/<provider>/<instance-hash>/operations.json`, outside the project. `--journal-directory` selects an explicitly private alternative. The directory and journal require `0700`/`0600` on POSIX. The journal holds desired fields needed for reconciliation, which can contain private document content. It must not be committed or shared. It does not contain provider credentials.

The write state machine persists intent before transmission, verifies selected fields afterward and deduplicates repeated plan execution. It distinguishes provider rejection, partial application and unknown outcome. An unresolved resource blocks another operation. Previously unfinished operations observed outside this service's active mutation become uncertain. An exclusive private `.operation-lock` directory serializes writers across connector processes; every transaction reloads the journal. A lock left by a stopped process is never stolen by timeout. Stop all writers, preserve and inspect the private journal, then remove only that stale lock directory before using reconciliation. Reconciliation observes current data; it does not prove who changed it or grant permission to replay. There is no automatic rollback across fields or resources.

## Validation

Run:

```sh
npx vitest run packages/integrations/test apps/atlassian-connector/test
npm run typecheck
npm run build:connectors
```

The connector suite uses actual HTTP mock-provider requests and a real local HTTP listener, including authorization, scope, pagination, malformed content, redirect/size limits, plan expiry, stale versions, a simulated atomic request-gap conflict, partial updates and post-effect response loss. Browser integration and real provider account validation remain distinct evidence layers.
