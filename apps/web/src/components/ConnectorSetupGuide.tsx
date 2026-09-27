import { useState } from 'react';
import { Download, ExternalLink, FolderOpen, KeyRound, Terminal } from 'lucide-react';
import { Dialog } from './Dialog';
import styles from './ConnectorSetupGuide.module.css';

type Connector = 'git' | 'jira' | 'confluence';
type Platform = 'macos' | 'windows' | 'linux';
const names = { git: 'Git', jira: 'Jira', confluence: 'Confluence' };
const ports = { git: 43120, jira: 43121, confluence: 43122 };
const repository = 'https://github.com/enzovalley9/bmad-project-ui';
const quote = (value: string, windows: boolean) =>
  windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;

function Command({ title, children }: { title: string; children: string }) {
  return (
    <div className={styles.command}>
      <p>
        <Terminal size={14} aria-hidden="true" />
        {title}
      </p>
      <pre role="region" aria-label={title} tabIndex={0}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function ConnectorSetupGuide({
  provider,
  onClose,
}: {
  provider: Connector;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(() =>
    /Win/i.test(navigator.platform)
      ? 'windows'
      : /Mac/i.test(navigator.platform)
        ? 'macos'
        : 'linux',
  );
  const [deployment, setDeployment] = useState<'cloud' | 'data-center'>('cloud');
  const name = names[provider];
  const windows = platform === 'windows';
  const git = provider === 'git';
  const origin = window.location.origin;
  const session = `${provider}-session`;
  const credentials = `${provider}-credentials.json`;
  const directory = windows ? '$env:USERPROFILE\\.bmad-project-ui' : '$HOME/.bmad-project-ui';
  const separator = windows ? '\\' : '/';
  const installer = windows
    ? '.\\install.cmd'
    : platform === 'macos'
      ? './install.command'
      : './install.sh';
  const installed = windows
    ? "Set-Location (Join-Path $env:LOCALAPPDATA 'BMAD Project UI\\connectors')"
    : platform === 'macos'
      ? 'cd "$HOME/Library/Application Support/BMAD Project UI/connectors"'
      : 'cd "${XDG_DATA_HOME:-$HOME/.local/share}/bmad-project-ui/connectors"';
  const prepare = windows
    ? `New-Item -ItemType Directory -Force -Path "${directory}" | Out-Null`
    : `mkdir -p "${directory}"\nchmod 700 "${directory}"`;
  const instance =
    deployment === 'cloud' ? 'https://your-team.atlassian.net' : `https://${provider}.example.com`;
  const args = git
    ? `git --repo ${quote(windows ? 'C:\\path\\to\\your\\project' : '/absolute/path/to/your/project', windows)} --origin ${quote(origin, windows)} --token-file "${directory}${separator}${session}"`
    : `atlassian --provider ${provider} --deployment ${deployment} --instance ${quote(instance, windows)} --origin ${quote(origin, windows)} --token-file "${directory}${separator}${session}" --credentials-file "${directory}${separator}${credentials}"`;
  const command = `${installed}\n${windows ? '.\\bmad-connectors.cmd' : './bmad-connectors'} ${args}`;
  const sourceCommand = `npm ci\nnpm run connector:${git ? 'git' : 'atlassian'} -- ${args.slice(args.indexOf(' ') + 1)}`;

  return (
    <Dialog title={`Install and start the ${name} connector`} onClose={onClose} wide>
      <div className={styles.guide}>
        <p className={styles.intro}>
          Install the connector package once, then run {name} on the same computer as this browser.
          The package includes Node.js; you do not need to install Node separately.
        </p>
        <div className={styles.facts}>
          <div>
            <FolderOpen size={18} aria-hidden="true" />
            <strong>Project access</strong>
            <span>
              {git
                ? 'Git runs in the repository you select. The browser verifies that it opened the same folder.'
                : `${name} connects to your account. The browser reads and saves project files; this connector does not open the repository or run Git.`}
            </span>
          </div>
          <div>
            <KeyRound size={18} aria-hidden="true" />
            <strong>Authorization</strong>
            <span>
              {git
                ? 'Uses your installed Git, SSH agent and credential helpers for remotes.'
                : `Uses ${name} credentials stored on your computer, outside the project.`}
            </span>
          </div>
          <div>
            <Terminal size={18} aria-hidden="true" />
            <strong>Local address</strong>
            <code>http://127.0.0.1:{ports[provider]}</code>
            <span>Keep its terminal open while connected.</span>
          </div>
        </div>
        <div className={styles.options}>
          <label>
            Operating system
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              <option value="macos">macOS · Terminal</option>
              <option value="windows">Windows · PowerShell</option>
              <option value="linux">Linux · Terminal</option>
            </select>
          </label>
          {!git && (
            <label>
              {name} deployment
              <select
                value={deployment}
                onChange={(event) => setDeployment(event.target.value as typeof deployment)}
              >
                <option value="cloud">Cloud</option>
                <option value="data-center">Data Center</option>
              </select>
            </label>
          )}
        </div>
        <ol className={styles.steps}>
          <li>
            <h3>Check what you need</h3>
            {git ? (
              <p>
                Install{' '}
                <a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer">
                  Git
                </a>
                , open an existing local Git repository in the web app, and make sure Git can access
                its remote from your terminal. Configure your Git identity for commits. Remote login
                prompts are not handled in this page.
              </p>
            ) : (
              <p>
                You need an account with access to the{' '}
                {provider === 'jira' ? 'Jira project and issues' : 'Confluence space and pages'} you
                want to connect. Check with your administrator which credentials your{' '}
                {deployment === 'cloud' ? 'Cloud site' : 'Data Center installation'} permits. Each
                connector runs separately, with its own session file.
              </p>
            )}
            <p>
              Use desktop Chrome or Edge. Enable Edit mode when binding Git, saving integration
              links or importing changes.
            </p>
          </li>
          <li>
            <h3>Download and install</h3>
            <a
              className={styles.download}
              href={`${repository}/releases`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={16} aria-hidden="true" />
              Download connectors
              <ExternalLink size={14} aria-hidden="true" />
            </a>
            <p>
              Choose the{' '}
              <code>
                bmad-project-ui-connectors-
                {platform === 'macos' ? 'darwin' : platform === 'windows' ? 'win32' : 'linux'}
                -ARCH.tar.gz
              </code>{' '}
              asset matching your processor: <code>arm64</code> for Apple Silicon/ARM or{' '}
              <code>x64</code> for Intel/AMD. Extract the archive completely, including on Windows.
              If no matching asset is listed, use the source alternative below.
            </p>
            <p>
              Open {windows ? 'PowerShell' : 'Terminal'} in the extracted package folder and run:
            </p>
            <Command title="Install the package">{installer}</Command>
            <p>
              The installer prints its destination. It preserves existing installations and does not
              add a command to PATH or start a service. The commands below use its default location;
              use the printed folder if you chose a different destination.
            </p>
            <details>
              <summary>Alternative: run from source</summary>
              <p>
                Download or clone the{' '}
                <a href={repository} target="_blank" rel="noopener noreferrer">
                  application source
                </a>{' '}
                and install Node.js 24. After preparing the files in the next step, run these
                commands from the application checkout. Replace the example project or instance path
                first.
              </p>
              <Command title="Run from source">{sourceCommand}</Command>
              <p>This starts the connector, not the web server.</p>
            </details>
          </li>
          <li>
            <h3>Prepare the local files</h3>
            <p>
              Create a directory for connector sessions{git ? '' : ' and credentials'} outside your
              BMAD project:
            </p>
            <Command title="Create the connector directory">{prepare}</Command>
            {!git && (
              <>
                <p>
                  Save <code>{credentials}</code> in that directory with a plain-text editor, using
                  UTF-8 without a BOM. Replace the example values locally.{' '}
                  {deployment === 'cloud'
                    ? 'For this site-URL profile, use your Atlassian account email and an API token without scopes:'
                    : 'For a Data Center instance that supports personal access tokens, use an administrator-approved token:'}
                </p>
                <Command title="Provider credentials file">
                  {deployment === 'cloud'
                    ? '{\n  "email": "you@example.com",\n  "apiToken": "REPLACE_LOCALLY"\n}'
                    : '{\n  "bearerToken": "REPLACE_LOCALLY"\n}'}
                </Command>
                {deployment === 'cloud' && (
                  <p>
                    <a
                      href="https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Atlassian API token instructions
                    </a>
                    . Scoped tokens use a different API gateway; this guide does not configure that
                    profile. If your organization requires it, check the supported profiles with
                    your administrator. The connector does not manage OAuth sign-in or token
                    renewal.
                  </p>
                )}
                {windows ? (
                  <p>
                    Use the file and folder Security properties to restrict access to your Windows
                    account. Do not put credentials in the project or upload this file to the
                    browser.
                  </p>
                ) : (
                  <Command title="Protect the credentials file">{`chmod 600 "${directory}${separator}${credentials}"`}</Command>
                )}
              </>
            )}
            <p>
              The connector creates <code>{session}</code> when it starts. That generated file is
              what you will load in this page; it is{' '}
              {git ? 'not a GitHub token' : `different from ${credentials}`}.
            </p>
          </li>
          <li>
            <h3>Start {name}</h3>
            <p>
              {git
                ? 'Replace the example repository path with the full path of the same project folder you selected in the browser.'
                : `Replace ${instance} with your instance URL${provider === 'confluence' && deployment === 'cloud' ? ', without /wiki (the connector adds it)' : ''}. For Data Center, include a deployment context path if your administrator requires it.`}
            </p>
            <Command title={`Start the ${name} connector`}>{command}</Command>
            <p>
              The command allows this exact web address: <code>{origin}</code>. If the app address
              changes, restart with the new <code>--origin</code>. Keep the terminal running; look
              for <code>listening on 127.0.0.1:{ports[provider]}</code>, check for startup errors,
              then verify the connection in the next step.
            </p>
          </li>
          <li>
            <h3>Connect in this page</h3>
            {git ? (
              <ol>
                <li>Close this guide and enable Edit mode.</li>
                <li>
                  Use <strong>http://127.0.0.1:43120</strong> as the local connector address.
                </li>
                <li>
                  Choose <strong>Load session file</strong> and select <code>{session}</code> from
                  your connector directory.
                </li>
                <li>
                  Review repository trust, then choose <strong>Connect and bind project</strong>. A
                  temporary marker verifies that both sides opened the same folder.
                </li>
                <li>
                  Check the displayed repository and branch. Save files locally, review a commit,
                  then review a push when you want to share it.
                </li>
              </ol>
            ) : (
              <ol>
                <li>
                  Close this guide and choose <strong>Set up connection</strong> (or continue the
                  open setup).
                </li>
                <li>
                  In <strong>Instance</strong>, use <code>http://127.0.0.1:{ports[provider]}</code>{' '}
                  as the local connector address, not your {name} website.
                </li>
                <li>
                  In <strong>Authorize</strong>, load <code>{session}</code> with{' '}
                  <strong>Load session file for {name}</strong>, then verify the account shown.
                </li>
                <li>
                  Choose the remote {provider === 'jira' ? 'project' : 'space'} and local folder in{' '}
                  <strong>Scope</strong>. Check access, review the summary and save the connection
                  in Edit mode.
                </li>
                <li>
                  Find an existing {provider === 'jira' ? 'issue' : 'page'}, review it and confirm
                  its link. Compare fields before choosing a reviewed local import or export.
                </li>
              </ol>
            )}
            {!git && (
              <p className={styles.note}>
                Connecting does not synchronize content. Current production profiles support
                reading, comparison, export and reviewed local import. Remote publication is blocked
                where the provider cannot guarantee a safe update.
              </p>
            )}
          </li>
          <li>
            <h3>Reconnect or stop</h3>
            <p>
              After reopening the browser, load the session file again. If you stopped the
              connector, run the same start command first. Use <strong>Disconnect</strong> in the
              app to end its session and <strong>Ctrl+C</strong> in the connector terminal to stop
              the local process. Disconnecting the page does not stop that process.
            </p>
          </li>
        </ol>
        <details className={styles.troubleshooting}>
          <summary>Troubleshooting</summary>
          <dl>
            <dt>Cannot reach the connector</dt>
            <dd>
              Check that its terminal is still running and the address uses <code>127.0.0.1</code>{' '}
              with the right port. If that port is occupied, restart with <code>--port</code> and
              enter the same port in the app. If the browser requests local-network access, allow it
              only for the expected connector.
            </dd>
            <dt>Authorization fails</dt>
            <dd>
              Load the generated {session}, check the exact <code>--origin</code>, and reconnect
              after session expiry.{' '}
              {git
                ? 'For remote Git access, check your terminal credentials and SSH agent.'
                : `For a provider rejection, check the ${name} credential type, expiry and account permissions. Restart the connector after changing credentials.`}
            </dd>
            <dt>{git ? 'The folder cannot be bound' : 'No project or space appears'}</dt>
            <dd>
              {git
                ? 'Select the exact repository root in both places, enable Edit mode and allow browser writes. A matching folder name alone is not enough.'
                : `Verify the account and instance. Your account must be able to view the selected ${provider === 'jira' ? 'project' : 'space'}; the connector does not grant additional permissions.`}
            </dd>
            <dt>Installation or startup fails</dt>
            <dd>
              Extract every archive file, choose the correct system/processor package, and use its
              installed folder. Check credential-file permissions and valid JSON. Preserve any
              existing installation before choosing a new destination. Packages are unsigned;
              checksums verify file integrity, not publisher identity.
            </dd>
          </dl>
        </details>
        <p>
          <a
            href={`${repository}/blob/main/docs/connector-setup.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full connector setup guide
          </a>
        </p>
        <div className={styles.footer}>
          <button className="primary" onClick={onClose}>
            Back to connection
          </button>
        </div>
      </div>
    </Dialog>
  );
}
