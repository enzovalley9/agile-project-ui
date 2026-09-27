# Host Agile Project UI on Cloudflare

Agile Project UI is a local-first workspace for documents, stories and sprints. Compatible with BMAD Method, it is an independent application; hosting it does not imply endorsement by BMad Code, LLC.

The selected deployment target is `agile-project-ui.enzovalley9.workers.dev`. This guide describes how to deploy and verify that target; configuration alone does not establish that the website is live.

The frontend can be served as a static website. The included Cloudflare configuration publishes only `dist/web` using Workers Static Assets. There is no Worker entry point, application database, server-side rendering or uploaded project storage.

A visitor does not need a Cloudflare account. Cloudflare delivers HTML, CSS, JavaScript and public help pages; the visitor's browser opens their project through the native folder picker. Git, Jira and Confluence connectors continue to run on that visitor's computer. Hosting the frontend does not host those services or gain access to their credentials.

## Cost and scope

Cloudflare currently charges no additional storage fee for Static Assets, and requests served directly from static assets are free and unlimited. Invoking a Worker script has different pricing; this configuration does not run one. Check the current [Static Assets billing documentation](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) before changing the architecture or enabling additional services.

The free plan currently allows up to 20,000 static files per Worker version and 25 MiB per file. The build checks both limits. See [Cloudflare's platform limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets). Connector archives are not copied into the static website; they belong in [GitHub Releases](releases.md).

A `workers.dev` address does not require purchasing a domain. This setup does not require R2, KV, D1, Durable Objects, a paid Workers plan or paid build services. Do not add bindings, paid plans or a custom domain as an incidental deployment step.

## Prepare the exact build

Use the pinned Node runtime and install dependencies from the committed lockfile. Begin with a reviewed, clean checkout of the intended release revision.

```sh
npm ci
npm run check
npm run format:check
npm run notices:check
npm run audit:dependencies
npm run deploy:check
```

`deploy:check` builds the web application, generates the public help pages and version metadata, checks the public asset allowlist, and runs a Wrangler dry run. It does not publish the site. A passing dry run does not prove account access or live browser behavior.

The allowlist accepts the app entry page, hashed Vite assets, reviewed response headers, the MIT license, third-party notices, explicit public help pages, four maintained screenshots, the reviewed original example ZIP and `version.json`. It rejects source maps, symlinks, unexpected files and directories, project fixtures, connector packages and private metadata. The public help generator reads an explicit list of maintained product documents; it never reads the separate private documentation repository.

`version.json` contains only the package version and full source Git revision. It includes no timestamp, local filesystem path or account credential. Build from a clean checkout so that the recorded revision identifies the deployed source.

## Select an account and deploy

The person deploying needs Cloudflare account access and permission to deploy Workers. Authenticate with Wrangler using the intended account, then check the account before publishing:

```sh
npx wrangler login
npx wrangler whoami
```

Never paste an authentication token into the repository or browser application. Keep unattended deployment credentials in the deployment environment's secret store. The application has no Cloudflare credentials in its build.

Set the intended account ID and choose an available, approved Worker name. Replace the uppercase placeholders below; the account ID is a deployment setting, not a provider credential for Git, Jira or Confluence.

```sh
# macOS/Linux
export CLOUDFLARE_ACCOUNT_ID='YOUR_ACCOUNT_ID'
npm run deploy:web -- --name YOUR_WORKER_NAME
```

```powershell
# Windows PowerShell
$env:CLOUDFLARE_ACCOUNT_ID = 'YOUR_ACCOUNT_ID'
npm run deploy:web -- --name YOUR_WORKER_NAME
```

The command rebuilds and checks the allowlist before uploading the static assets. Record the returned HTTPS URL and deployment/version ID. It does not change the GitHub repository's visibility or publish a GitHub release. See [Cloudflare's Static Assets setup guide](https://developers.cloudflare.com/workers/static-assets/get-started/) for account and deployment requirements.

## Verify the live website

Open the returned HTTPS URL directly in a current desktop Chrome or Microsoft Edge browser.

1. Confirm that `/version.json` reports the intended release version and source revision. Check that the page, JavaScript, stylesheet, license and public help load successfully.
2. Open a disposable synthetic project through the native folder picker. Confirm its documents and work items are visible.
3. Enable edit mode, grant write permission, edit one document and compare its saved bytes independently. Reload and reopen the project to verify persistence.
4. Open `/help/connector-setup/` and `/help/support/` without GitHub authentication. Their internal documentation links must remain usable.
5. Confirm that a nonexistent path returns an error instead of exposing source files or private build material. Check response security headers and the browser console.
6. Exercise the hosted-to-local connector flow described below. An HTTP 200 from the static site alone does not prove file access or connector functionality.

The [testing guide](testing.md) distinguishes automated file fixtures from the native picker and real provider authentication. Jira and Confluence mock coverage is not live account certification.

The automated acceptance suite can target the deployed origin after building the local connector:

```sh
npm run build:connectors
AGILE_PROJECT_UI_HOSTED_URL='https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev' npm run test:hosted
```

Run from the same source revision as the deployment: the suite requires `/version.json` to match the local package version and exact Git HEAD. It uses real disposable files through an automated picker boundary and the actual local Git CLI. It checks headers, private-path rejection, public help, saving, a reviewed commit, story movement and theme persistence. The browser context grants local-network permission for the test. A separate native browser run must still verify the real folder picker and permission prompts.

## Connect the hosted page to local services

Start the connector on the same computer as the browser. Use the public application's **exact HTTPS origin** for `--origin`: scheme, hostname and optional port, with no path or trailing slash. The in-app installation guide inserts the current origin into its commands.

For example, replace the origin in the [connector setup guide](connector-setup.md) with `https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev`. A development origin such as `http://127.0.0.1:5173` is not interchangeable with that hosted origin. Keep the local connector address on loopback, such as `http://127.0.0.1:43120`; do not expose it through a public tunnel.

The browser may ask for permission to connect to local services. Allow that permission only for the intended application if you want to use its connector. Browser and enterprise policies can block it; follow the browser's site-permission controls or consult the administrator. Do not disable browser security checks to make the connection work. Chrome documents this boundary in its [Local Network Access guidance](https://developer.chrome.com/blog/local-network-access).

Folder permission, write permission, local-network permission and the connector's local session are separate. Load only the generated connector session file; provider credentials remain outside the browser. For Git, explicitly choose repository trust and bind the same selected project folder. A new application origin requires a new directory grant and matching connector configuration; browser-private recovery data does not move between origins automatically.

## Public help and private downloads

The website's `/help/` pages are generated from public-facing product documentation and are accessible anonymously. The application, documentation and legal notices can be public while the GitHub repository remains private.

Private GitHub releases, source links and issue forms still require repository access. A public help page does not make a private download available to everyone. Keep that restriction visible to visitors; do not proxy private GitHub credentials through the app or silently expose release assets. See [release access](releases.md).

## Update and rollback

Deploy each update from a reviewed source revision after the checks above. Record the previous and new source commits, deployment IDs and live acceptance result. Avoid deploying local uncommitted work with a misleading source revision.

If an update fails, select the application in Cloudflare **Workers & Pages → Deployments**, identify the previous known-good version and use its rollback action. Verify the selected version before applying it; see the current [Cloudflare rollback instructions](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). Record the resulting deployment ID and repeat the version, asset, help and browser checks.

If the intended version is no longer available for rollback, rebuild its recorded source revision in a separate clean checkout and deploy it to the same account and Worker name. Preserve other local work. Never replace a checkout destructively merely to rebuild an old release.

Rolling back the website changes delivered application assets. It does not revert files already saved in a visitor's project, browser-private recovery data, connector installations, Git commits or provider operations. Preserve unresolved operation evidence and reconcile it through the relevant connector rather than repeating a mutation.
