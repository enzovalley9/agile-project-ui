# Architecture

Agile Project UI is a local-first workspace for documents, stories and sprints. Compatible with BMAD Method, it runs as a static browser application with optional local Node processes. Files in the selected project are authoritative. Provider data is authoritative on its provider; reviewed imports do not silently replace either side.

The historical `.bmad-project-ui` sidecar namespace, private journal defaults and browser storage identifiers are retained for compatibility with existing project data. They are not the current product name. Changing them without migration would hide comments, integration links or recovery evidence. Do not rename these directories as part of updating the application.

## Components

| Location                                 | Responsibility                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                               | React/TypeScript UI built with Vite; file selection, visual/source editing, comments, work projections and connector clients. |
| `apps/web/src/services/project-store.ts` | Browser file permissions, bounded reads, revisions, coordinated writes, recovery and local-image scope.                       |
| `packages/domain`                        | BMAD configuration discovery, indexing, source provenance, work projections and reviewed structured edit plans.               |
| `packages/comments`                      | Versioned thread schema, physical fragment anchors, reactions and serialization.                                              |
| `packages/integrations`                  | Provider-independent association/comparison contracts and portable content handling.                                          |
| `apps/git-connector`                     | Loopback HTTP capability, exact browser-folder binding, reviewed native Git operations and private recovery journal.          |
| `apps/atlassian-connector`               | Separate Jira/Confluence processes, credential boundary, provider adapters, reviewed plans and reconciliation.                |
| `scripts`                                | Connector bundling, pinned Node runtime packaging, verified installation and package smoke checks.                            |

CodeMirror provides source editing. Rendered Markdown uses unified/remark/react-markdown with application-owned editing and resource rules. Hono serves connector HTTP routes. There is no server required to store or serve the user's project documents.

## Local data flow

1. The browser receives a directory handle through its native picker and reads supported, bounded text files.
2. Domain indexing derives documents and work items with source locations and explicit coverage diagnostics. It does not rewrite originals or synthesize authoritative task states.
3. A user enters editor mode and grants write permission. A reviewed edit checks the expected revision, creates recovery metadata/copies, writes and verifies.
4. An external revision change keeps the draft and requests another review. Unresolved markers remain readable raw text and do not contribute structured BMAD entities.
5. A comment writes its own versioned sidecar. It does not modify the anchored document.

| Storage                                      | Purpose                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Project documents                            | Authoritative BMAD content and states.                                           |
| `.bmad-project-ui/comments/threads/`         | Versionable user-created discussion sidecars.                                    |
| Versioned integration association files      | Explicit identities, scopes and selected-field links; not provider credentials.  |
| `.bmad-project-ui/local/`                    | Temporary binding and hash recovery metadata; excluded from connector commits.   |
| Browser-private storage                      | Recovery copies and verified comparison bases, scoped to browser/profile/origin. |
| Connector user directory outside the project | Local capabilities, private credentials and operation journals.                  |

Derived projections can always be rebuilt from files. Browser-private data is auxiliary; clearing it can remove recovery copies and comparison history. Unsaved text drafts are not durable storage.

## Work projections and appearance

Story and sprint moves use the same reviewed source-edit plan as the field editor; dragging never changes an optimistic application-only status. The Move button exposes the same action to keyboard users. A unique execution document supplies the story checklist. Before that document exists, a sprint story can display the checklist from one unambiguous epic breakdown. Competing breakdowns or execution files are not silently merged or selected; every editable task retains its original source range and revision.

The light/dark/system preference is stored separately in browser local storage and follows system changes when requested. It never changes project files. Theme tokens also cover the lazy-loaded CodeMirror editor.

## Trust boundaries

The browser can access only granted handles, but project content remains untrusted. The reader blocks active HTML, avoids automatic remote-image loads and bounds local-image types and paths. Parsing failures and partial inventories are visible.

Each connector listens on loopback and validates exact origin/host and a local capability. Binding Git requires a challenge through the selected browser directory, not a folder-name match. Native Git hooks, filters and credential helpers run only after repository trust; the application does not sandbox trusted native programs.

Git reviews and verifies exact operations while preserving external changes and existing locks. Atlassian connectors cannot read local project files or run Git. Their capabilities fail closed when a provider cannot supply the required update guarantees. See the [Git](git-connector.md) and [Atlassian](atlassian-connectors.md) protocol guides.

These protections do not create OS-wide transactions across arbitrary external editors. There is no hosted account system, authoritative database, background agent execution or automatic project synchronization.
