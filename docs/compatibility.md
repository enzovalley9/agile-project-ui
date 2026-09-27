# Support matrix

Agile Project UI is a **public beta** and an independent project compatible with **BMAD Method 6.12.0**. The tested adapter handles the formats represented by the maintained examples. Future BMAD versions, forks and every possible document layout are not automatically covered.

## Browsers and features

| Workflow                                                              | Desktop Chrome / Edge                                      | Desktop Firefox / Safari                                | Mobile browsers                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Built-in demo                                                         | Read-only                                                  | Read-only                                               | Read-only, compact layout                                     |
| Import selected folder                                                | Read-only text snapshot                                    | Read-only text snapshot where folder input is available | Depends on the device's folder picker; demo remains available |
| Read original folder and refresh external changes                     | Supported on HTTPS / localhost                             | Not supported                                           | Not supported                                                 |
| Edit documents, stories, sprint states and comments in original files | Supported with explicit folder write permission            | Not supported                                           | Not supported                                                 |
| Git connector                                                         | Supported on the same desktop computer                     | Not supported in snapshot mode                          | Not supported                                                 |
| Jira / Confluence                                                     | Experimental read, link, compare and reviewed local import | Not supported in snapshot mode                          | Not supported                                                 |

A snapshot never writes, tracks external changes, connects to providers, or imports local images. Import it again to reread. Text imports use the same scope and size limits as the original-folder reader. Excluded/unsupported files are counted; this filter is not a complete secret detector. Files remain in the current browser tab and are not uploaded. The demo is original fictional data.

Automated acceptance covers Chromium and Microsoft Edge for the full workflow. Firefox/WebKit fallback checks approximate their engines, not a claim of physical-device acceptance on every Safari/mobile version. Browser policy, secure contexts and local-network permissions can prevent access even in a supported browser.

## Project and installation folders

An original project folder may contain `_bmad-output` without `_bmad`. Supported documents and work items remain available for reading and editing; Diagnostics reports the absent installation. Without a manifest from a selected installation, the BMAD version is unknown. Comments require a valid project root, such as a repository with `.git`, and stay in that root's `.bmad-project-ui` folder. Git binds to that exact repository root.

For a shared installation, select its parent folder and then explicitly select a child project, or open the child first and connect the parent from Diagnostics. The browser must grant access to both folders. The parent contributes BMAD configuration only; configured paths are hints, and files outside the selected project are not added to its inventory. Nested Git repositories are never scanned just because their parent was selected. Text formats and size limits still apply; this is not a promise to import every file type.

## Feature maturity

| Area                       | Beta behavior and boundary                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documents                  | Read Markdown, edit text/source, follow local links, explicitly scoped local raster images. No HTML/MDX execution.                                                     |
| Stories, epics and sprints | Provenance, checklists, status boards, reviewed state changes and keyboard alternatives to dragging. Unknown/ambiguous formats report diagnostics.                     |
| Comments                   | Versionable sidecars with locally declared author, replies and reactions. No authenticated team identity.                                                              |
| Recovery                   | Revision checks and recovery review after interrupted writes. No universal transaction across external editors.                                                        |
| Git                        | Explicit repository trust/binding; separate save, commit and push; existing local branches. No force push, automatic merge or graphical conflict resolution.           |
| Atlassian                  | Separate local services; Cloud/Data Center adapters have explicit capabilities. Production remote writes are disabled. Mock coverage is not live-tenant certification. |
| Agents / skills            | Read-only catalog. No agent or workflow execution.                                                                                                                     |

Native connector platforms and installation requirements are listed in [releases](releases.md). Docker supports Linux AMD64/ARM64; Docker changes hosting and packaging, not browser capabilities. [First steps](first-use.md) explain the shortest supported path; [the roadmap](roadmap.md) separates current behavior from future work.
