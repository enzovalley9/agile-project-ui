# Your first project

No account is required for the public application. Start with disposable example data before trusting a real repository or editing valuable documents. See the [support matrix](compatibility.md).

## 1. Open a project or explore the demo

Open [Agile Project UI](https://agile-project-ui.enzovalley9.workers.dev) and select **Choose project folder** to open your own project. To explore sample data first, select **Try the demo** in the separate **Just exploring?** section. Browse Documents, Stories, Epics and Sprint. Open a story to inspect its source and tasks. Try the dark theme. This built-in fictional project is read-only; closing the tab discards its snapshot.

To read your own files without the directory-access API, use the same **Choose project folder** button. The app automatically opens a read-only snapshot when direct folder access is unavailable. The browser reads supported selected text locally. It does not upload the folder. Snapshots cannot edit, connect Git or refresh from disk; import again after external changes. Mobile folder selection depends on the operating system. The demo works without that permission.

## 2. Save a real local edit

The Documents tree shows `_bmad-output`, `docs`, `doc`, `documentation`, and document folders resolved from BMAD configuration. Other project files, such as root package manifests and source directories, stay out of the tree. Keep choosing the project root for Git; use **Diagnostics → Add documentation folder** for a custom documentation location. Selecting a documentation folder directly also works. This filters navigation, not filesystem permissions or the text inventory used for configuration and document links.

1. [Download the Community Garden ZIP](https://agile-project-ui.enzovalley9.workers.dev/example/community-garden.zip) and extract it into a new disposable folder. It contains original MIT-licensed planning documents, two epics, stories and sprint tracking. No BMAD installation is needed.
2. In desktop Chrome or Edge, select **Choose project folder**, then select the extracted `community-garden` root. Grant read access.
3. Open `docs/notes/meeting.md`, turn on **Edit**, and grant write access to this folder. Add a short line and choose **Save**. Inspect the same file in your ordinary text editor to confirm the bytes were saved.
4. In Stories or Sprint, move a supported story and review the affected files before confirming. Reading never changes a story's status automatically.

If access is blocked, use HTTPS or localhost and open the app directly rather than inside an embedded frame. Managed browsers can restrict folder/local-network access. Unsaved changes live in the tab: save or export before closing. Never delete recovery records to dismiss a failed write.

### Projects with a shared BMAD installation

If your repository contains `_bmad-output` but no `_bmad`, choose the repository itself with **Choose project folder**. Supported text documents and work items can still be read and edited. Diagnostics explains that no installation was detected; the BMAD version remains unknown without installation metadata. Comments are saved under `.bmad-project-ui` in the selected project root when it has a project-root marker such as `.git`.

If `_bmad` is in a parent folder, expand **More folder options**, choose **Choose shared BMAD installation** and select that parent. The app shows configured document locations as hints, then asks you to choose the child project folder explicitly. Chrome or Edge requests access to both folders. The installation supplies BMAD configuration; document reads and writes, comments and optional Git use the selected child project. You can also open the child project first and use **Connect shared BMAD installation** in Diagnostics to select its parent later. Choose the project repository root for Git, not the shared parent: the connector requires that exact repository root. When the configured BMAD output identifies exactly one nested repository, opening the parent selects that child automatically and retains the parent installation metadata. Other repositories remain excluded. If output configurations identify multiple repositories, use the explicit shared-installation selection flow.

## 3. Add Git when you need it

Git is optional. Initialize only your disposable example, or open an existing repository you trust. Install and start the [Git connector](connector-setup.md) on the same computer, using the exact app origin. Its preflight checks and setup helper explain the required paths.

Bind the same project repository root in the connection panel, even when its BMAD installation lives in a parent folder. Saving, committing and pushing are separate actions. Review every change and commit locally first. A push additionally needs an existing remote and your usual native Git authentication; the web app never asks for a GitHub password. Trusting Git permits that repository's configured hooks, filters, signing tools and credential helpers.

Jira and Confluence each have their own optional connector and credentials. They are experimental, do not require Git, and do not currently publish production remote changes. Reading your project never requires either service.

## Get help

Use [Support](../SUPPORT.md) or email [Enzo Valley](mailto:enzovalley9@gmail.com). Include browser, OS and exact app/connector versions. Send a minimal synthetic example, not a real project's sensitive contents or a session/token file.

## Diagrams and snapshot connectors

Fenced `mermaid` blocks render locally in the visual document view and follow the selected light or dark theme. Expand **Mermaid source** to read the original code, or use the Markdown editor to change it. An invalid or oversized diagram keeps its source and shows a preview warning; diagram clicks and active HTML are disabled.

Git, Jira and Confluence setup guides remain visible in imported snapshots and the demo. A snapshot cannot write back to the original folder. To edit, save or configure an active connector, open the live site in desktop Chrome or Edge, choose the original folder and enable **Edit**. Installing a connector does not give a snapshot write access. The existing [Atlassian capability limits](atlassian-connectors.md) still apply.

### Brave

Brave disables writable folder access by default. Open `brave://flags/#file-system-access-api`, set **File System Access API** to **Enabled**, and relaunch Brave. Return to the live site and choose the original project folder again. The flag applies to the browser, not just this site; folders still require your permission. Brave is not in the automated Chrome/Edge support matrix. See the [Brave issue](https://github.com/brave/brave-browser/issues/44411).
