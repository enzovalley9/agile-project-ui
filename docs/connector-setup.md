# Set up Git, Jira and Confluence

The web app reads and saves your project through the browser's folder permission. Optional connectors run on **the same computer as the browser**. Install the package once and start each connector you need in a separate terminal.

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
| Installation already exists         | Preserve it; choose another destination or handle an intentional replacement separately. The installer does not overwrite it.                               |
| An operation has an unknown outcome | Use the app's check/reconciliation flow before any new operation; do not repeatedly submit it.                                                              |

## Alternative: run from source

Download or clone the [application repository](https://github.com/enzovalley9/agile-project-ui) and install Node.js 24. From that checkout, run `npm ci`. Prepare the same session/credential files above, then substitute:

- `npm run connector:git --` for `./agile-connectors git`.
- `npm run connector:atlassian --` for `./agile-connectors atlassian`.

Keep every following argument unchanged. The source commands run a connector, not the web server. Source development uses `npm run dev` separately; see [development](development.md).
