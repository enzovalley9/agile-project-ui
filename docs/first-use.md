# Your first project

No account is required for the public application. Start with disposable example data before trusting a real repository or editing valuable documents. See the [support matrix](compatibility.md).

## 1. Explore without installing

Open [Agile Project UI](https://agile-project-ui.enzovalley9.workers.dev) and select **Try the demo**. Browse Documents, Stories, Epics and Sprint. Open a story to inspect its source and tasks. Try the dark theme. This built-in fictional project is read-only; closing the tab discards its snapshot.

To read your own files without the directory-access API, select **Import folder for reading**. The browser reads supported selected text locally. It does not upload the folder. Snapshots cannot edit, connect Git or refresh from disk; import again after external changes. Mobile folder selection depends on the operating system. The demo works without that permission.

## 2. Save a real local edit

1. [Download the Community Garden ZIP](https://agile-project-ui.enzovalley9.workers.dev/example/community-garden.zip) and extract it into a new disposable folder. It contains original MIT-licensed planning documents, two epics, stories and sprint tracking. No BMAD installation is needed.
2. In desktop Chrome or Edge, select **Choose project folder**, then select the extracted `community-garden` root. Grant read access.
3. Open `docs/notes/meeting.md`, turn on **Edit**, and grant write access to this folder. Add a short line and choose **Save**. Inspect the same file in your ordinary text editor to confirm the bytes were saved.
4. In Stories or Sprint, move a supported story and review the affected files before confirming. Reading never changes a story's status automatically.

If access is blocked, use HTTPS or localhost and open the app directly rather than inside an embedded frame. Managed browsers can restrict folder/local-network access. Unsaved changes live in the tab: save or export before closing. Never delete recovery records to dismiss a failed write.

## 3. Add Git when you need it

Git is optional. Initialize only your disposable example, or open an existing repository you trust. Install and start the [Git connector](connector-setup.md) on the same computer, using the exact app origin. Its preflight checks and setup helper explain the required paths.

Bind the same project folder in the connection panel. Saving, committing and pushing are separate actions. Review every change and commit locally first. A push additionally needs an existing remote and your usual native Git authentication; the web app never asks for a GitHub password. Trusting Git permits that repository's configured hooks, filters, signing tools and credential helpers.

Jira and Confluence each have their own optional connector and credentials. They are experimental, do not require Git, and do not currently publish production remote changes. Reading your project never requires either service.

## Get help

Use [Support](../SUPPORT.md) or email [Enzo Valley](mailto:enzovalley9@gmail.com). Include browser, OS and exact app/connector versions. Send a minimal synthetic example, not a real project's sensitive contents or a session/token file.
