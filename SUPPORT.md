# Support

Start with the [README](README.md), [development guide](docs/development.md), [Git connector guide](docs/git-connector.md) or [Atlassian guide](docs/atlassian-connectors.md). No hosted support service, paid support agreement or response-time guarantee is currently provided.

For a reproducible bug, open an issue using the bug-report template. For a question or proposed feature, use the relevant issue template. Include your exact version/commit, desktop browser/version, OS and whether a connector is involved. Supply a minimal synthetic file rather than an export of a private BMAD project.

Use [the security policy](SECURITY.md) for sensitive reports. Never attach a local session file, API token, unredacted browser storage export or connector credentials.

## Common problems

| Symptom                              | Check                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No directory picker                  | Use desktop Chrome/Edge on HTTPS or loopback; verify the page is opened directly and browser policy allows directory access.                            |
| Writes are unavailable               | Enable edit mode and grant write permission. Check recovery/conflict diagnostics and whether another save/operation is still running.                   |
| An external edit blocked saving      | Keep/export the draft, reread the file and compare. Do not delete recovery records to force a write.                                                    |
| Git connection rejected              | Match the exact page origin, local endpoint and session file; choose repository trust deliberately and bind the same project root.                      |
| Git result is uncertain              | Use reconciliation and inspect the recorded local/remote state. Do not repeat the mutation blindly.                                                     |
| Native Git authentication fails      | Verify your normal Git client and launch environment's credential helper/SSH agent. Do not paste Git-provider credentials into this UI.                 |
| Jira/Confluence cannot publish       | Inspect adapter capabilities. Current production profiles block updates without adequate concurrency/draft guarantees; this is an intentional boundary. |
| Some files or work items are missing | Read diagnostics for scope limits, unsupported formats, conflicting markers or missing structured adapters. Partial coverage is explicit.               |
| Recovery copies disappeared          | Check whether the browser profile/origin changed or its private storage was cleared. Unsaved drafts and private copies have different lifetimes.        |

Use a disposable clone or copy when investigating. Preserve the original files and evidence of an uncertain outcome before trying a workaround.
