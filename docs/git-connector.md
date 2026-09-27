# Optional native Git connector

For installation and browser setup, start with the [connector setup guide](connector-setup.md). It covers the bundled runtime, all three operating systems, session files and troubleshooting. The reference below describes profiles and protocol behavior. The guide also covers verified updates, rollback, the `doctor` preflight and interactive `setup` launcher. Installed software versions are visible in the connection panel; the browser validates product, provider and protocol 1 before authorization and mutations.

The web app reads and saves project documents with browser directory permissions. This connector only binds that browser folder to a locally authorized repository and runs reviewed native Git operations. It has no general file endpoint, terminal, agent runtime or Git-provider token form.

## Start locally

Use Node 24 and the Git already installed on the computer for development:

```sh
npm run connector:git -- --repo /absolute/project/root --origin http://127.0.0.1:5173 --token-file /private/directory/agile-git-capability
```

The token file's parent directory must already exist and must be outside the repository. The connector creates the file privately if absent, or reads an existing private regular file. It never prints the capability. Default address is `127.0.0.1:43120`; `--port` can select another unprivileged port. The exact web origin must match, including scheme and port. Runtime-included distribution uses the same arguments and native Git configuration.

Load the local capability file in the web connection panel. It grants the connector session; it is not a GitHub token. Keep it out of repositories, URLs, screenshots and logs. Native Git uses the launch environment's SSH agent and installed credential helpers. A graphical launcher may need different environment setup from a terminal. The connector does not change global Git configuration, install helpers or weaken ownership checks.

Before mutations, explicitly choose whether to trust this repository's Git hooks, filters, signing programs and credential helpers. A read permission does not establish that trust. Native status is limited when an untrusted repository configures executable content filters; browser document reading remains available. Submodule inspection is not recursive. Hooks can have their own effects; the connector verifies the intended Git result and warns when Git reported an error despite observing that result.

## Browser-folder verification

1. Establish a session with the trust choice.
2. Request a short-lived challenge.
3. In editor mode, use the selected browser directory handle to write the exact challenge content to its given path under `.bmad-project-ui/local/git-bindings/`.
4. Verify the challenge through the API. The connector reads only the path it issued, rejects symlinks and confirms the authorized repository's identity.
5. Remove the temporary marker through the browser. Use the returned binding ID on subsequent requests.

No marker is written in read mode. The web app can remain fully usable without Git. A fresh challenge distinguishes identical clones; a matching folder name or file hash alone is not sufficient. The marker contains no capability token. Challenges expire after two minutes; sessions after eight hours. Disconnecting revokes trust, binding and unexecuted plans.

## HTTP API v1

All requests except health require an exact authorized `Origin` and `Authorization: Bearer <local capability>`. Repository, plan and operation routes also require `X-BMAD-Binding`. POST bodies are JSON, limited to 64 KiB. Errors are `{ "error": { "code": "...", "message": "..." } }`; raw native command errors and credentials are not returned.

| Method and path                      | Body or response                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`                     | Product identity, protocol `1` and application version. Health alone does not prove a bound project or working Git.                |
| `POST /v1/session`                   | `{trustRepository: boolean}` → protocol, trust, expiry and binding requirement.                                                    |
| `DELETE /v1/session`                 | Revoke the current session.                                                                                                        |
| `POST /v1/bindings/challenge`        | `{}` → `{id,path,content,expiresAt}`.                                                                                              |
| `POST /v1/bindings/verify`           | `{id}` → `{bindingId,rootName,removePath}`.                                                                                        |
| `GET /v1/repository`                 | Branch, HEAD, changed/staged/conflicted paths, native operation markers, sanitized remote destinations and trust.                  |
| `GET /v1/branches`                   | Existing local branches, current flag and whether a branch belongs to another worktree.                                            |
| `POST /v1/plans/commit`              | Context plus `{paths,message}` → explicit reviewed diffs and expiring plan ID.                                                     |
| `POST /v1/plans/branch`              | Context plus `{branch}` → existing clean-branch plan.                                                                              |
| `POST /v1/plans/push`                | Context plus `{remote,branch}` → exact destination and every outgoing commit/file diff.                                            |
| `POST /v1/operations`                | Context plus `{planId}` → recorded operation. Reusing the plan ID returns its existing operation.                                  |
| `GET /v1/operations`                 | Up to 20 public records, unresolved first, newest first, with `hasMore`. Call on every reconnect/reload to discover recovery work. |
| `GET /v1/operations/by-plan/:planId` | Recover the operation ID when the initial POST response was lost; 404 if no operation was recorded.                                |
| `GET /v1/operations/:id`             | Recorded status and verification evidence.                                                                                         |
| `POST /v1/operations/:id/reconcile`  | `{}` → reread native/remote state without replaying the mutation.                                                                  |

Context is `{drafts: number, saving: boolean, recoveryPending: boolean}` and must reflect the current browser state at both review and execution. Branch/commit require no pending drafts; push publishes reviewed commits and may leave drafts or saved changes local. Any save in progress or partial-save recovery blocks mutations. The frontend must also disable its own saves while an operation that can alter project files is running. The service cannot inspect in-memory browser drafts.

Plans expire after five minutes. They contain a public ID, operation kind, summary, HEAD and reviewed files, with destination/commits where applicable. The service privately retains the exact expected HEAD, branch, configuration, index and file hashes. Expiry or a changed relevant revision requires a new review.

Operations have an ID, plan ID, kind, timestamps and `running`, `verified`, `rejected` or `uncertain` status. A confirmed commit includes its actual HEAD; a confirmed push includes the independently observed remote SHA. Read-after-write verification may also recognize a known descendant containing the intended push tip. An unknown remote object keeps the result uncertain rather than assuming ancestry.

## Commit and push safeguards

- A preexisting staged index blocks commits without altering it. Select explicit changed paths; unrelated work is preserved. Filenames are literal, including Git pathspec-like strings, spaces, newlines and leading dashes.
- Repository snapshots must match before and after review rendering, and reviewed files are rehashed before execution. A private index stages exactly the selected changes, then native Git commits that index with its usual hooks and signing. Copying and publishing the index preserve Git's timestamp-based rehash protection, including same-size edits with indistinguishable filesystem timestamps. The real index is locked during this operation and replaced only after commit verification. Changes made to working files after staging remain uncommitted. The resulting commit's parent, message, changed paths and blobs are verified. External programs and trusted hooks are not constrained by a filesystem transaction; a verification mismatch remains uncertain and blocks another mutation.
- Known secret paths (`.env*`, secret directories and private-key file extensions) and local connector journals are rejected before their contents enter a review. This also applies to every outgoing historical commit, including files deleted later. Untracked files must be valid UTF-8 text without NUL bytes to be reviewed here. These path rules do not replace a full secret scanner.
- Every native command ignores replacement objects and legacy `info/grafts`, so review, ancestry checks, commit verification and transport inspect the original objects. The connector preserves those local history overlays without using them. Otherwise an apparently clean replacement can hide sensitive files that a push would still transfer.
- Switching requires a clean worktree and an existing local branch that is not checked out elsewhere. There is no implicit stash, discard, branch creation or conflict resolution.
- Push supports HTTPS/SSH, one effective destination and one existing remote branch. Credentials embedded in URLs, multiple push URLs, unsupported remote helpers and unreviewable history are rejected. Every native invocation also restricts Git's transport allowlist, including URL rewrites and redirects; repository configuration cannot enable FTP, unencrypted HTTP or external transport helpers. Local filesystem remotes are enabled only through the test/programmatic option, not CLI defaults. Docker additionally omits legacy HTTP/WebDAV push support; use smart HTTPS or SSH with that distribution.
- The review includes all outgoing commits, including files changed and subsequently deleted. Merge commits show their first-parent change; individual outgoing parent commits remain listed. A review is limited to 4 MiB of diffs, 100 outgoing commits and 200 files per commit; larger changes remain available in your Git client.
- Push uses the reviewed commit SHA and explicit destination ref. There is no force push, automatic fetch, pull, merge or rebase. A missing local remote-tip object or divergence requires the user's Git client.
- Timeout does not mean failure. The journal survives restart, and reconciliation reads the exact remote ref or local commit before another mutation is allowed. The same plan never repeats a recorded operation.
- Connector processes refresh shared journals before mutations and recheck them under the private operation lock. Reconciliation of an unresolved operation requires renewed repository trust because it can invoke native credential helpers.
- Preexisting Git index/ref locks are never removed. During a commit, the connector creates and releases its own native index lock; an unverified private index is retained as recovery evidence. Connector processes also use a separate private operation lock. Reconciliation may release that private operation lock only for its recorded operation after verifying that its owning PID no longer exists. Unknown locks remain untouched.

Private operation journals live under the user's `.bmad-project-ui/git-connector/` outside the project, with restrictive Unix permissions. They contain recovery metadata, not document diffs or capability tokens. Use a private user directory with appropriate ACLs on Windows. Corrupt journals are not executable plans. A recreated installation without those records cannot recover an unknown prior operation automatically.

## Validation boundaries

The connector integration suite runs against real temporary native repositories and bare remotes. It covers authentication/binding, index preservation, stale reviews, literal paths, hooks/locks, branch/worktree rules, outgoing history, rejected/divergent destinations, ambiguous responses and persisted recovery. Replacement-object and legacy-graft cases check that hidden sensitive commits never reach the remote; a graft added after review must not alter the reviewed ancestry during push. It does not establish desktop installer signing or provider credential availability on another computer. Browser directory access, platform installers and a real private GitHub roundtrip are separate acceptance checks.

Three native Git cases run only on macOS/Linux: rejecting a file symlink, committing/deleting a filename that combines spaces, shell metacharacters and a newline, and treating `:(glob)*` as a literal filename. Creating the symlink may require extra Windows privileges; the latter two names contain characters Windows forbids. These cases are explicitly skipped on Windows, so its passing suite does not prove equivalent symlink behavior. All remaining native Git cases run on all three platforms.
