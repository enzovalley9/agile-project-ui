# Set up Git, Jira and Confluence

The web app reads and saves your project through the browser's folder permission. Optional connectors run on **the same computer as the browser**. Install the package once and start each connector you need in a separate terminal.

Prefer containers? The [Docker guide](docker.md) runs the web app and each optional connector from one image, with separate Compose profiles, private state and credential mounts. It includes container-specific Git authentication and ownership instructions; the native installation steps below use your host's Git and configuration instead.

| Connector  | What it accesses                                                                                         | Default address          |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| Git        | The exact local repository supplied with `--repo`, through your installed Git.                           | `http://127.0.0.1:43120` |
| Jira       | Your Jira account and selected project. The browser maps local stories and saves reviewed imports.       | `http://127.0.0.1:43121` |
| Confluence | Your Confluence account and selected space. The browser maps local documents and saves reviewed imports. | `http://127.0.0.1:43122` |

Jira and Confluence processes do not read project files or run Git. They read their own credential files and maintain local operation journals. Each provider has its own process, credentials and browser session; connecting one does not connect the others.

Agile Project UI is compatible with BMAD Method. Its optional connectors are local services for this independent application; they are not official BMAD Method services.

These instructions use the current `agile-connectors` launcher and new application install directories. Existing project sidecars and default operation journals keep their historical `.bmad-project-ui` namespace for compatibility; do not move or delete them during an update. The session/credential paths below are configurable examples, not a migration requirement.

## 1. Download and install

[Download connectors from Releases](https://github.com/enzovalley9/agile-project-ui/releases). The GitHub repository and releases currently require repository access; sign in to an authorized account. A public web app URL does not grant that access. See [release access and verification](releases.md).

Select an available `agile-project-ui-connectors-SYSTEM-ARCH.tar.gz` asset for your computer:

| System  | Package system | Processor suffix                           |
| ------- | -------------- | ------------------------------------------ |
| macOS   | `darwin`       | `arm64` for Apple Silicon; `x64` for Intel |
| Windows | `win32`        | `x64` for Intel/AMD; `arm64` for ARM       |
| Linux   | `linux`        | `x64` for Intel/AMD; `arm64` for ARM       |

Choose a published asset matching both values. If your target has no package, use the source alternative below. The package includes Node.js; a separate Node installation is unnecessary for the packaged connectors. **Git itself must be installed separately for the Git connector.** See [Git downloads](https://git-scm.com/downloads).

Extract the entire `.tar.gz`, including on Windows. Open a terminal in the extracted folder and run:

| System  | Terminal   | Install command     | Default destination                                                |
| ------- | ---------- | ------------------- | ------------------------------------------------------------------ |
| macOS   | Terminal   | `./install.command` | `$HOME/Library/Application Support/Agile Project UI/connectors`    |
| Windows | PowerShell | `.\install.cmd`     | `$env:LOCALAPPDATA\Agile Project UI\connectors`                    |
| Linux   | Terminal   | `./install.sh`      | `${XDG_DATA_HOME:-$HOME/.local/share}/agile-project-ui/connectors` |

The installer prints its destination. It accepts `--destination ABSOLUTE_DIRECTORY`, verifies copied files and preserves an existing installation. It does not add the launcher to PATH, register auto-start or start a connector. Use the installed directory in the commands below; substitute the printed path for a custom installation.

Packages are unsigned and not notarized. Checksums establish file integrity, not publisher identity. Do not bypass OS security protections just because an archive has a checksum.

## 2. Prepare session and credential files

Keep this directory outside your project. If your project contains the suggested location, choose another location and update the commands.

macOS/Linux:

```sh
mkdir -p "$HOME/.agile-project-ui"
chmod 700 "$HOME/.agile-project-ui"
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agile-project-ui" | Out-Null
```

Restrict the Windows directory and credential files to your account through their Security properties. POSIX mode checks do not verify Windows ACLs.

### Git

No provider credential file is needed. Configure your installed Git identity, SSH agent or credential helper and verify remote access from the terminal before using the app. The connector does not display interactive Git login prompts or request a GitHub token. Open an existing repository root in the browser; that exact root is used with `--repo`.

The parent directory for `git-session` must already exist and must be outside the repository. The connector generates the session file on first start; do not create an empty placeholder.

### Jira and Confluence

You need an account that can view the target project/issues or space/pages. Obtain credentials approved for your account and deployment. The connector does not grant new provider permissions, register OAuth apps, sign you in through OAuth or renew tokens.

Create separate `jira-credentials.json` and `confluence-credentials.json` files with a plain-text editor. Save **UTF-8 without a BOM**. For the Cloud site-URL profile shown below:

```json
{
  "email": "you@example.com",
  "apiToken": "REPLACE_LOCALLY"
}
```

Replace the examples locally with your account email and an API token without scopes. Atlassian distinguishes site-URL tokens from scoped tokens, which use an API gateway. This guide does not configure the scoped-token gateway profile; if your organization requires it, check compatibility with your administrator. See [Atlassian's token instructions](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/) and [Jira basic authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/).

For a Data Center deployment that supports personal access tokens, an administrator-approved credential can use:

```json
{ "bearerToken": "REPLACE_LOCALLY" }
```

The transport also accepts a single `authorization` field containing a provider-supported Authorization header. These are alternative profiles: use only one, with no extra keys. Account/server support must be verified; accepting the JSON shape does not certify a particular server version.

On macOS/Linux, after saving each credential file:

```sh
chmod 600 "$HOME/.agile-project-ui/jira-credentials.json"
chmod 600 "$HOME/.agile-project-ui/confluence-credentials.json"
```

Protect only the files you created. Never upload these JSON files to the app or put them in the project. The **generated session file**, described next, is the file to load in the browser.

## Guided launcher and diagnostics

From the installed directory, run `./agile-connectors doctor` (Windows: `.\agile-connectors.cmd doctor`). It prints the installed version, source revision, bundled Node version and platform, validates every package checksum, and checks whether Git is available. It does not read provider credentials or contact a remote account.

Optional checks: `doctor --repo /absolute/repository/root --port 43120` verifies the exact local Git root and whether a loopback port is available. Port checks briefly bind and close the local socket; they do not certify browser permission or an account login. An occupied port might belong to an already-running connector.

Run `./agile-connectors setup git`, `setup jira` or `setup confluence` for interactive startup (Windows: `.\agile-connectors.cmd setup git`). The prompts collect your app origin and file paths, never provider tokens. Prepare private provider credential files first. The last prompt requires `yes` before the launcher starts anything. No service, login item or automatic restart is installed. The direct commands below remain available for scripts and troubleshooting.

## 3. Start the connector

The UI installation guide inserts the current browser origin for you. In the examples below, replace `http://127.0.0.1:5173` with your actual app origin: scheme, hostname and port, with **no path or trailing slash**. Preview commonly uses port 4173; a hosted app uses its HTTPS origin. `localhost` and `127.0.0.1` are different origins.

Enter the installed directory first:

```sh
# macOS
cd "$HOME/Library/Application Support/Agile Project UI/connectors"
# Linux (run this instead on Linux)
cd "${XDG_DATA_HOME:-$HOME/.local/share}/agile-project-ui/connectors"
```

```powershell
# Windows PowerShell
Set-Location (Join-Path $env:LOCALAPPDATA 'Agile Project UI\connectors')
```

### Git

Replace the project path with the same repository root selected in the browser.

```sh
./agile-connectors git --repo '/absolute/path/to/your/project' --origin 'http://127.0.0.1:5173' --token-file "$HOME/.agile-project-ui/git-session"
```

```powershell
.\agile-connectors.cmd git --repo 'C:\path\to\your\project' --origin 'http://127.0.0.1:5173' --token-file "$env:USERPROFILE\.agile-project-ui\git-session"
```

### Jira

Replace the example instance URL. For Data Center, change `--deployment cloud` to `--deployment data-center` and use your HTTPS base URL, including a deployment context path if needed.

```sh
./agile-connectors atlassian --provider jira --deployment cloud --instance 'https://your-team.atlassian.net' --origin 'http://127.0.0.1:5173' --token-file "$HOME/.agile-project-ui/jira-session" --credentials-file "$HOME/.agile-project-ui/jira-credentials.json"
```

```powershell
.\agile-connectors.cmd atlassian --provider jira --deployment cloud --instance 'https://your-team.atlassian.net' --origin 'http://127.0.0.1:5173' --token-file "$env:USERPROFILE\.agile-project-ui\jira-session" --credentials-file "$env:USERPROFILE\.agile-project-ui\jira-credentials.json"
```

### Confluence

For Cloud, supply the site origin **without `/wiki`**; the adapter appends it. For Data Center use `--deployment data-center` and the instance's full deployment base URL.

```sh
./agile-connectors atlassian --provider confluence --deployment cloud --instance 'https://your-team.atlassian.net' --origin 'http://127.0.0.1:5173' --token-file "$HOME/.agile-project-ui/confluence-session" --credentials-file "$HOME/.agile-project-ui/confluence-credentials.json"
```

```powershell
.\agile-connectors.cmd atlassian --provider confluence --deployment cloud --instance 'https://your-team.atlassian.net' --origin 'http://127.0.0.1:5173' --token-file "$env:USERPROFILE\.agile-project-ui\confluence-session" --credentials-file "$env:USERPROFILE\.agile-project-ui\confluence-credentials.json"
```

Start each connector in its own terminal and keep that terminal open. Startup reports `listening on 127.0.0.1:PORT` and creates or reuses its session file. Check for subsequent errors, such as an occupied port; the log line alone does not confirm a running listener. Verify the local connection and account access in the browser as described next.

Use `--port` for an occupied default port and update the browser address to match. All listeners use `127.0.0.1`; enter that literal address in the connector panel.

## 4. Finish connecting in the browser

### Git

1. Open the project root and enable Edit mode.
2. Open Git, enter the local address and choose **Load session file** → `git-session`.
3. Review trust in this repository's hooks, filters and credential helpers.
4. Choose **Connect and bind project**. The browser creates and removes a temporary marker to verify the exact folder against the connector.
5. Check the repository name and branch. Saving files, reviewing a commit and reviewing a push are separate actions.

### Jira or Confluence

1. Open the corresponding panel and choose **Set up connection**. The Prepare step also links to the full installation instructions.
2. In **Instance**, enter the local connector address from the table at the top, not the provider website.
3. In **Authorize**, choose **Load session file for Jira/Confluence** and select `jira-session` or `confluence-session`. Authorize and inspect the verified account.
4. In **Scope**, choose the remote project/space and the local folder. Check access, review the summary and save the configuration in Edit mode.
5. Search for an existing issue/page, inspect it and confirm the link. Compare selected fields before reviewing a local import or export.

Connecting or linking does not synchronize content. Production profiles support reading/comparison and reviewed local imports/exports. Remote publication is blocked where the provider cannot prove safe update guarantees. Data Center bodies remain opaque and have more limited comparison/import support. See [the profile matrix](atlassian-connectors.md#supported-profiles-and-current-limits).

## 5. Reconnect, stop and troubleshoot

After reopening a page, load its connector session file again. If the process stopped, restart it first. After changing the app origin or provider credentials, restart with the updated configuration. End the browser session with **Disconnect**; stop the process separately with **Ctrl+C** in its terminal.

| Symptom                             | Check                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cannot reach the connector          | Running terminal, literal `127.0.0.1`, matching port and current app origin. If prompted, allow browser local-network access only for the expected service. |
| Session authorization fails         | Load the generated session file for that connector, not a provider token or credentials JSON. Reauthorize after expiry.                                     |
| Git binding fails                   | Exact repository root in both places, Edit mode, granted write permission and reviewed trust.                                                               |
| Git remote authentication fails     | Credential helper/SSH agent in the launcher environment. Resolve interactive login in the terminal first.                                                   |
| Provider rejects access             | Credential type/expiry, account permissions and exact HTTPS instance/context. For Confluence Cloud, avoid adding `/wiki` twice.                             |
| No project or space appears         | Verify account and instance, then confirm that account can view the target in the provider.                                                                 |
| Startup fails                       | Correct package architecture, extracted files, valid credential JSON without BOM and restrictive file permissions.                                          |
| Installation already exists         | Use the explicit update flow below, or choose a different destination. A normal install never overwrites it.                                                |
| An operation has an unknown outcome | Use the app's check/reconciliation flow before any new operation; do not repeatedly submit it.                                                              |

## Updates and rollback

The public website may update before your local package. The connector panel shows the installed version and protocol. This web app supports **protocol 1** for Git, Jira and Confluence, including the original 0.1.0 release. Its versionless Atlassian health response is recognized as legacy metadata; new packages report their package version. The browser validates the exact product/provider, protocol and version shape before sending its capability, and rechecks health before every authenticated request. Different software versions are compatible when they share this protocol; an unsupported or malformed service is rejected before the operation is sent.

1. Finish or reconcile any pending operation. Disconnect in the browser and stop **all** connector terminals with Ctrl+C. The update requires an explicit `--confirm-stopped`; new launchers also maintain process leases that block replacement while a connector is running. Original 0.1.0 launchers have no lease, so the stop confirmation remains essential. New leases include process birth identity rather than relying on a PID alone. Startup and maintenance remove only records for exited processes or a different process that reused the recorded PID; they never terminate that unrelated process. A live lease without birth metadata remains blocking because its identity cannot be proved.
2. Download and verify the new archive, then extract it into a **separate** folder. Keep that extracted folder until acceptance and rollback checks are complete.
3. Run its installer with `--update --confirm-stopped`. Add `--destination ABSOLUTE_DIRECTORY` if you used a custom destination. Examples from the extracted folder:

```sh
# macOS; Linux uses ./install.sh with the same arguments.
./install.command --update --confirm-stopped
```

```powershell
.\install.cmd --update --confirm-stopped
```

Both the source package and existing installation are checked before replacement. A verified staging copy is activated only after its bundled runtime passes a native check. The old directory is retained as `connectors.previous` beside the installation. Extra or modified installation files, a live process lease or an existing previous copy cause a refusal. No elevation, network request or automatic download is part of updating. A checksum validates package integrity, not publisher identity; obtain the archive from the release channel you trust.

Start from the normal installed path again, run `doctor`, then reconnect and check the displayed version, folder binding and recovery state. Project files, credentials, session files, `.bmad-project-ui` sidecars and external operation journals are neither migrated nor deleted. Keep these outside the installation; unknown files inside it must be preserved elsewhere or handled with a separate installation, rather than silently overwritten. Do not delete journals to get around an unresolved operation.

To roll back, first disconnect and stop all connector processes again. From the **separate extracted package**, run:

```sh
./install.command --rollback --confirm-stopped
```

```powershell
.\install.cmd --rollback --confirm-stopped
```

On Linux substitute `./install.sh`. Use the same `--destination` for a custom installation. Rollback verifies and restores the previous package, and retains the replaced version under `connectors.rollback-retained-<id>` for recovery. It does not reset project data or replay operations. Reconnect and check compatibility before writing. Before another update, move any existing `connectors.previous` to a backup location after you have verified which version it contains; the installer never deletes that backup for you.

### Interrupted maintenance

Ordinary copy or activation failures leave the old installation usable and clean up this installer's staging and lock. A power loss or forced process termination cannot run that cleanup. First verify that no installer or connector is running. Preserve all installation and backup directories before proceeding:

- If the normal destination still exists, inspect its `manifest.json` and run its `doctor`; keep the `.previous` copy until you verify the active version.
- If the destination is missing but its sibling `.previous` exists, restore that directory to the original destination name. This recovers the untouched old installation; do not run a fresh install into the missing destination first.
- Only after checking that no maintenance process remains, remove that destination's `.connectors.install-lock` directory. Do not delete a live `.running` process record to bypass an update refusal. Stale records with verifiable process birth identity are pruned automatically under the lock; an unreadable or malformed record needs manual inspection after every connector has stopped. A leftover `.connectors.staging-*` directory contains the incomplete new package and can be moved aside. Do not remove `.bmad-project-ui` state, credential folders or other installations.
- Retry from a verified extracted archive or contact the maintainer with the error text and version only. Do not attach capability or provider credential files.

The update protocol uses staging and recoverable same-filesystem renames, not a transaction across the operating system and running processes. Automated native smoke tests cover copy failure, activation failure with restoration, live-process rejection, update, rollback and an untouched external journal; they do not simulate every filesystem or power-loss behavior.

## Alternative: run from source

Download or clone the [application repository](https://github.com/enzovalley9/agile-project-ui) and install Node.js 24. From that checkout, run `npm ci`. Prepare the same session/credential files above, then substitute:

- `npm run connector:git --` for `./agile-connectors git`.
- `npm run connector:atlassian --` for `./agile-connectors atlassian`.

Keep every following argument unchanged. The source commands run a connector, not the web server. Source development uses `npm run dev` separately; see [development](development.md).
