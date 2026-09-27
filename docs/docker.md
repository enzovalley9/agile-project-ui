# Install locally with Docker

One image contains the web app, Git, Node.js and the optional Git, Jira and Confluence connectors. Each container runs one service. Start the web app alone, then enable the connectors you need with Compose profiles.

Use Docker Engine with Compose v2 on Linux, or Docker Desktop in Linux-container mode on macOS/Windows. Open the app in desktop Chrome or Edge **on the same computer as Docker and the project folder**. Docker does not replace the browser's local-folder permission or make this a hosted multiuser workspace.

## Image availability

The image reference is `ghcr.io/enzovalley9/agile-project-ui:latest`; use a published `sha-<full-commit>` tag or digest to pin a specific build. Image visibility is separate from the source repository, which currently requires access. A public GHCR image can be pulled without a GitHub account. If the registry denies a pull, check the package visibility/tag or build from an authorized source checkout. The public website alone does not prove registry availability. No Docker Hub image is implied.

Pulling and running the image and extracting its Compose files require no source checkout. The image includes both AMD64 and ARM64 variants when published through the container workflow.

## Licenses, sources and supply-chain verification

Every image includes exact corresponding Debian, Node.js and OpenSSH source archives, copyright notices and machine-readable inventories. They can be extracted without running a container or accessing GitHub. This source payload increases image size. See [distribution and verification](supply-chain.md) for `docker cp` instructions, checksum validation, signed provenance and security scan policy.

## Start the web app

These commands use POSIX shell syntax. After publication, use the public image below or replace `latest` with a published version or digest:

```sh
AGILE_IMAGE=ghcr.io/enzovalley9/agile-project-ui:latest
docker pull "$AGILE_IMAGE"
docker run -d --name agile-project-ui --init \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -p 127.0.0.1:8080:8080 \
  "$AGILE_IMAGE"
```

Open **http://127.0.0.1:8080** and select your local project folder. Reading, editing and comments need no bind mount, connector or environment variable: the browser accesses those files directly. The image serves static application files and help; it does not receive your selected project. Keep using this exact origin because permissions, recovery copies and connector authorizations are origin-specific.

Stop this standalone instance before starting Compose on port 8080:

```sh
docker stop agile-project-ui
docker rm agile-project-ui
```

Removing a web container does not delete the project or browser storage.

In Windows PowerShell, set `$env:AGILE_IMAGE = 'ghcr.io/enzovalley9/agile-project-ui:latest'` and run the `docker run` command on one line, using `$env:AGILE_IMAGE` in place of `$AGILE_IMAGE`. The Docker commands and Compose profiles are otherwise the same; use `Copy-Item .env.docker.example .env` instead of `cp` if needed. In `.env`, use absolute Windows paths such as `C:/Users/your-user/projects/example` for bind sources. Configure Docker Desktop file sharing for those selected paths.

## Obtain Compose without a source checkout

The image includes the exact matching Compose file, configuration example and this guide at `/opt/agile-project-ui/docker`. Copy them out of a temporary container; it does not need to run:

```sh
mkdir agile-project-ui-docker
cd agile-project-ui-docker
docker create --name agile-project-ui-files "$AGILE_IMAGE"
docker cp agile-project-ui-files:/opt/agile-project-ui/docker/. .
docker rm agile-project-ui-files
cp .env.docker.example .env
```

Set `AGILE_IMAGE` in `.env` to the image you selected. If using source, `compose.yaml` and `.env.docker.example` already live at the checkout root. Neither installation route needs a local Node.js or Git installation to run the containers.

```sh
docker compose up -d
docker compose ps
```

Only `web` starts by default. The example publishes every port on `127.0.0.1`; keep those bindings. Do not expose connectors on a LAN/public address or use host networking. The process listens on the container interface for Docker forwarding, while browser origin, local Host, session and project-binding checks still apply.

## Prepare private connector state

Choose private directories **outside the project**. Each connector needs its own existing state directory. On macOS/Linux, for example:

```sh
mkdir -p "$HOME/.agile-project-ui/docker/git" \
  "$HOME/.agile-project-ui/docker/jira" \
  "$HOME/.agile-project-ui/docker/confluence"
chmod 700 "$HOME/.agile-project-ui" "$HOME/.agile-project-ui/docker" \
  "$HOME/.agile-project-ui/docker/git" \
  "$HOME/.agile-project-ui/docker/jira" \
  "$HOME/.agile-project-ui/docker/confluence"
```

Set the corresponding absolute `AGILE_*_STATE_DIR` paths in `.env`. Compose intentionally refuses missing bind sources instead of creating a mistyped project path. Do not create blank token files: the connector generates private `git-token`, `jira-token` or `confluence-token` files inside its own state folder. Journals live under `journal/<provider>` in that same folder. Preserve the complete state folder through restarts and upgrades, especially while an operation needs recovery.

The image runs as non-root UID/GID `1000:1000`. On **native Linux**, set `AGILE_UID` and `AGILE_GID` in `.env` to the output of `id -u` and `id -g` for the account that owns your repository and private directories. Do not use UID 0 or change ownership recursively on an existing repository. Rootless Docker/user namespaces may map IDs differently; inspect ownership from inside the container when configuring them.

On **Docker Desktop**, host macOS/Windows IDs are not automatically the IDs seen by its Linux VM. Start with `1000:1000`, allow Docker access only to the chosen folders, and check the mounted paths before starting connectors:

```sh
docker compose run --rm --no-deps --entrypoint sh git \
  -c 'id; stat -c "%u:%g %a %n" /workspace /workspace/.git /state; test -w /workspace && test -w /workspace/.git && test -w /state'
```

This Git check requires the Git paths configured below. State directories must appear private (`700`) and allow the running user to read, write and traverse them; credential files must appear as private regular files (`600`) and be readable by that user. Docker Desktop may report a synthetic owner such as `0:0` while correctly granting access to the non-root container process, so check actual access rather than requiring the displayed owner to equal your host UID. Windows ACLs alone do not prove the Linux container sees mode `600`. If a Desktop mount cannot preserve the required privacy and access, use a suitable Linux-backed storage path with controlled access, or use the native connector package. Never weaken the checks or mount your whole home directory to work around permissions.

## Optional Git connector

Set `AGILE_PROJECT_DIR` in `.env` to an **existing ordinary Git repository root**, and `AGILE_GIT_STATE_DIR` to its private state directory. The repository mounts read/write at `/workspace`. In the browser, choose that **same host folder**, not another clone. The connector proves this relationship with a browser-mediated binding challenge before allowing Git actions.

Start both services:

```sh
docker compose --profile git up -d
```

In the app's Git panel, keep the connector address `http://127.0.0.1:43120`, load the generated `git-token` file from your host state directory, and complete the folder-binding/trust flow. Treat session files as private credentials; do not paste their contents into terminals, reports or project files.

The supplied image supports smart HTTPS and SSH Git remotes. Legacy HTTP/WebDAV push is disabled: the XML-parsing `git-http-push` helper is absent. The connector restricts native remote transports to HTTPS and SSH, including redirects. The image ships a verified OpenSSH 10.5p1 client and no SSH server. SSH host-key verification remains enabled; configure a dedicated trusted `known_hosts` file for your remote.

The image removes privileged setuid/setgid execution, `infocmp`, and Perl's `Archive::Tar` entry point. Perl itself remains available for Git. These removals do not affect the tested core Git workflows, but optional repository hooks requiring them, PKCS#11/FIDO helper programs, or other external tooling require a maintained custom image. Review such additions and their security updates before trusting repository hooks.

The container uses **its own Linux Git**, configuration and executables. It does not inherit the host keychain, SSH agent, credential helper, global identity, GPG signer or hooks' dependencies. Configure repository-local `user.name`/`user.email`, or set all four optional `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` values in `.env`. These identify commits; they do not authenticate remote access.

Local commits and branch changes can work without remote credentials. Push is optional and remains a separate reviewed action. For remote authentication, use a dedicated least-privilege credential file/helper or SSH configuration through a custom Compose override with narrowly scoped, read-only mounts. The chosen helper, SSH client or signing tool must also exist in the Linux image; extend the image if needed. Do not embed tokens in remote URLs, the Dockerfile, build arguments or `.env`, and do not mount all of `~/.ssh`, the host home directory or the Docker socket. Review any repository hooks or filters before trusting them.

Git worktrees, submodules and repositories whose `.git` points outside the selected folder need their referenced paths available consistently inside the container; a single `/workspace` mount is insufficient. Prefer a normal standalone clone for this setup. On native Linux, resolve Git ownership refusals by matching the container UID to the repository owner. Do not configure `safe.directory=*`.

Docker Desktop can report a synthetic owner for `/workspace` even when the container user can access the intended repository. If Git refuses it as dubious ownership, first verify that `AGILE_PROJECT_DIR` mounts exactly the repository you intend to trust. Then set `AGILE_GIT_ALLOW_MAPPED_OWNERSHIP=1` in `.env` and recreate Git with `docker compose --profile git up -d git`. This opt-in defaults to `0` and adds `safe.directory` only for the resolved mounted repository on each connector Git command; it does not alter global/host Git configuration or trust other repositories. It does not replace the app's explicit repository trust and same-folder binding. Leave it disabled when normal UID ownership works.

### Dedicated HTTPS credentials

For an HTTPS remote, an optional isolated configuration can use Git's built-in credential store. This stores credentials as **plaintext**; protect the host file with mode `600` and your normal encrypted storage/backups. Create a dedicated `gitconfig` outside the project, replacing the URL with your exact remote and keeping credentials out of that URL:

```ini
[credential "https://github.com/OWNER/REPOSITORY.git"]
    helper =
    helper = store --file=/run/secrets/git-credentials
    useHttpPath = true
```

Prepare a separate credential file privately according to [Git's credential-store format](https://git-scm.com/docs/git-credential-store#_storage_format). Use a repository-scoped credential where your provider supports it. Do not enter a secret in a shell command that saves it to history. Mount only those two dedicated files, not an existing global Git configuration containing unrelated helpers or account settings.

Save this optional override as `compose.git-auth.yaml` beside `compose.yaml`, and put the two **host paths only** in `AGILE_GIT_CONFIG_FILE` and `AGILE_GIT_AUTH_FILE` in `.env`:

```yaml
services:
  git:
    volumes:
      - type: bind
        source: ${AGILE_GIT_CONFIG_FILE:?Set the dedicated Git config path}
        target: /home/node/.gitconfig
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: ${AGILE_GIT_AUTH_FILE:?Set the private Git credential path}
        target: /run/secrets/git-credentials
        read_only: true
        bind:
          create_host_path: false
```

```sh
docker compose -f compose.yaml -f compose.git-auth.yaml --profile git up -d
```

Include both `-f` arguments in later Compose commands for this setup. The container retains `HOME=/home/node` even with a configured numeric UID; both files must be readable by that UID. Restart the Git service after replacing a mounted credential file. The read-only store cannot save refreshed credentials; rotate the host file yourself. Repository trust is still required before credential helpers run. This recipe enables a credential source; successful remote authentication and push depend on your provider and must be verified separately.

## Optional Jira and Confluence connectors

Each connector is independent and has no project mount. It contacts only its configured provider using a separate read-only credential file. Configure the provider URL, deployment, host state directory and credential-file path in `.env`:

| Profile      | Required Compose variables                                                                     | Defaults                                        |
| ------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `jira`       | `AGILE_JIRA_INSTANCE`, `AGILE_JIRA_STATE_DIR`, `AGILE_JIRA_CREDENTIALS_FILE`                   | `AGILE_JIRA_DEPLOYMENT=cloud`, port 43121       |
| `confluence` | `AGILE_CONFLUENCE_INSTANCE`, `AGILE_CONFLUENCE_STATE_DIR`, `AGILE_CONFLUENCE_CREDENTIALS_FILE` | `AGILE_CONFLUENCE_DEPLOYMENT=cloud`, port 43122 |

Use your actual HTTPS instance URL (a typical Confluence Cloud URL includes `/wiki`). Deployment accepts `cloud` or `data-center`. Prepare each credential JSON using the [credential profiles in the connector setup guide](connector-setup.md#jira-and-confluence). Use exactly one supported profile: `email` plus `apiToken`, `bearerToken`, or `authorization`. These shapes do not certify every provider version or scoped-token gateway. Save UTF-8 without a BOM, outside the project, with mode `600`; mount the file read-only at `/run/secrets/credentials.json`. Credentials are runtime inputs and are never required when building the image.

```sh
docker compose --profile jira up -d
# Or run all services after configuring every selected connector:
docker compose --profile git --profile jira --profile confluence up -d
```

Load `jira-token` or `confluence-token` from the corresponding host state folder into its connection panel, then choose a project or space. **Upload the generated session file, never the provider credential JSON.** If Chrome/Edge asks to permit local-network access, allow the intended local connector for this app origin.

Current production-provider writes remain blocked where atomic updates or draft preservation cannot be guaranteed. Docker does not expand the adapter's capabilities. Mock-provider tests verify protocol and recovery behavior; they do not prove authentication, reads or writes against your live tenant. See [provider limits](atlassian-connectors.md).

## Configuration reference

The `.env` beside `compose.yaml` configures Compose interpolation. It is not automatically passed wholesale to a container. Keep tokens and passwords out of it. Change configuration, then run `docker compose` with the same selected profiles and `up -d` to recreate the affected services.

| Compose variable                                                                   | Purpose / default                                                                                     |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `AGILE_IMAGE`                                                                      | Image tag or immutable digest; `ghcr.io/enzovalley9/agile-project-ui:latest`.                         |
| `AGILE_UID`, `AGILE_GID`                                                           | Non-root container identity; `1000`, `1000`.                                                          |
| `AGILE_WEB_ORIGIN`                                                                 | Exact allowed browser origin; `http://127.0.0.1:8080`. No trailing slash or path.                     |
| `AGILE_PROJECT_DIR`                                                                | Existing absolute host Git repository root; required for Git.                                         |
| `AGILE_GIT_STATE_DIR`                                                              | Existing private host directory for Git session and journals.                                         |
| `AGILE_GIT_ALLOW_MAPPED_OWNERSHIP`                                                 | `0` by default; `1` explicitly allows only the mounted repository when Docker Desktop maps ownership. |
| `AGILE_JIRA_STATE_DIR`, `AGILE_CONFLUENCE_STATE_DIR`                               | Independent existing private host state directories.                                                  |
| `AGILE_JIRA_CREDENTIALS_FILE`, `AGILE_CONFLUENCE_CREDENTIALS_FILE`                 | Existing private host credential JSON paths, read-only mounts.                                        |
| `AGILE_JIRA_INSTANCE`, `AGILE_CONFLUENCE_INSTANCE`                                 | Provider HTTPS URLs, required only for that profile.                                                  |
| `AGILE_JIRA_DEPLOYMENT`, `AGILE_CONFLUENCE_DEPLOYMENT`                             | `cloud` (default) or `data-center`.                                                                   |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | Optional Git commit identity; omitted unless supplied.                                                |

When running connectors directly with `docker run`, the image accepts these **container-side** variables:

| Runtime variable                                                 | Used by            | Default / meaning                                                                            |
| ---------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `AGILE_WEB_ORIGIN`                                               | Web and connectors | `http://127.0.0.1:8080`; exact browser origin.                                               |
| `AGILE_REPO_PATH`                                                | Git                | `/workspace`; existing mounted repository.                                                   |
| `AGILE_GIT_ALLOW_MAPPED_OWNERSHIP`                               | Git                | `0` by default; `1` scopes a per-command Git ownership exception to the resolved repository. |
| `AGILE_STATE_DIR`                                                | All connectors     | `/state`; private writable persistent directory.                                             |
| `AGILE_CREDENTIALS_FILE`                                         | Jira/Confluence    | `/run/secrets/credentials.json`; private read-only file.                                     |
| `AGILE_ATLASSIAN_INSTANCE`                                       | Jira/Confluence    | Required HTTPS instance URL.                                                                 |
| `AGILE_ATLASSIAN_DEPLOYMENT`                                     | Jira/Confluence    | `cloud` or `data-center`, default `cloud`.                                                   |
| Four `GIT_AUTHOR_*` / `GIT_COMMITTER_*` identity variables above | Git                | Optional commit identity.                                                                    |

Select a service with the final command `web`, `git`, `jira` or `confluence`. Container ports are fixed at 8080, 43120, 43121 and 43122. Compose maps the provider-specific settings to the generic runtime variables. Host paths belong in mount sources, never in `AGILE_REPO_PATH` or the container-side credential path. For a different web host port, change its port mapping and `AGILE_WEB_ORIGIN` together; continue to bind the host port to `127.0.0.1`. Keep connector ports unchanged because their browser addresses and Host validation use those ports.

## Build from source

With authorized access to the source checkout, build without installing Node.js locally:

```sh
docker build \
  --build-arg AGILE_PROJECT_UI_BUILD_REVISION="$(git rev-parse HEAD)" \
  --tag agile-project-ui:local .
cp .env.docker.example .env
AGILE_IMAGE=agile-project-ui:local docker compose up -d
```

Set `AGILE_IMAGE=agile-project-ui:local` in `.env` for subsequent Compose commands. The revision argument must be the full 40-character commit SHA. Build from a clean checkout when you need provenance to match that SHA. This is public version metadata, not a credential. The build uses locked npm dependencies; runtime settings and secrets are supplied only when starting a container. `.dockerignore` restricts the build context, and the final image contains the built application, connector bundles, runtime, examples and license notices rather than your source checkout or Git history.

## Updates, persistence and troubleshooting

To update a published image, select a new reviewed tag/digest in `.env`, pull it, and recreate your selected services. Preserve state and project bind mounts:

```sh
docker compose --profile git --profile jira --profile confluence pull
docker compose --profile git --profile jira --profile confluence up -d
docker compose ps
```

Use only profiles you configured. Pinning an image digest allows you to return to that exact build. Finish or resolve pending operations before changing connector versions. Back up project files and private journals through your usual protected backup process; browser recovery remains in the browser's storage, not Docker volumes. `docker compose down` stops/removes containers and networks but keeps bind-mounted files. Deleting private state is not a normal update or recovery step.

### Git after a forced stop

Each Git state directory belongs to one connector instance. Do not share it between native and container connectors or multiple containers. A forced stop can leave `journal/git/operation.lock` inside that private state folder. Container PID reuse can make the previous process appear alive, so the connector intentionally refuses new operations; this requires manual recovery.

Stop the Git service first. Confirm that no other native or container process uses this state directory, and review the pending operation and its observed local/remote outcome before touching its lock. Then move **only the private connector lock** to a uniquely named backup, preserving all journals and project files. Do not move or delete `.git/index.lock` or other Git locks.

```sh
docker compose stop git
# After the checks above, use your actual host state directory:
AGILE_GIT_STATE_DIR='/absolute/private/path/git'
agile_lock_backup="$AGILE_GIT_STATE_DIR/journal/git/operation.lock.backup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mv -n "$AGILE_GIT_STATE_DIR/journal/git/operation.lock" "$agile_lock_backup"
```

Confirm the move succeeded and the backup exists, then restart the service with `docker compose --profile git up -d git` (include your override `-f` arguments if configured). Reconnect, explicitly trust and bind the same folder, then reconcile any pending operation through the UI **before attempting a new mutation**. An uncertain remote outcome needs investigation; do not blindly retry a push. Never automate lock removal. This procedure preserves recovery evidence but does not promise automatic recovery from every interrupted operation.

An interrupted commit can leave a native `.git/index.lock` and an isolated `<operation-id>.index` in the private Git journal directory. The commit itself may already exist while the normal index has not been updated. Reconciliation can verify that commit, but further changes remain blocked until you inspect and repair the native Git state externally. Keep both indexes and the journal as evidence; the private connector-lock procedure above does not repair native Git locks or staged/index differences. Do not replay the commit or delete those files blindly.

### Troubleshooting

| Symptom                    | Check                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Image pull denied          | Confirm the published image/tag exists and is public, or build from an authorized source checkout.                    |
| Port already allocated     | Stop another container or native connector using that port; keep connector ports stable.                              |
| Missing mount source       | Correct the absolute host path and create only the intended private state folder yourself.                            |
| Permission/ownership error | Check UID/GID and Linux-visible `700` state / `600` credential modes; do not run as root to bypass them.              |
| Git folder mismatch        | Open the exact host folder mounted at `/workspace` and repeat binding.                                                |
| Git commit/push fails      | Check container-side identity, hooks, signing and remote authentication separately.                                   |
| Origin rejected            | Use `http://127.0.0.1:8080`, or restart connectors with your exact app origin; `localhost` differs.                   |
| Provider connection fails  | Verify instance, deployment, credential profile and network access; never upload provider credentials to the browser. |

`docker compose logs --tail=30 SERVICE` shows startup diagnostics. Review and redact paths, account data and provider output before sharing logs. Readiness/health checks show the service can respond; they do not prove browser folder access, a successful Git operation or live-provider compatibility.

## Mirror to another registry

The image is not tied to GHCR. If you maintain a registry namespace, you can copy a verified release to it using your own authenticated registry tools. For a single local platform:

```sh
docker pull "$AGILE_IMAGE"
docker tag "$AGILE_IMAGE" registry.example.com/your-namespace/agile-project-ui:chosen-version
docker push registry.example.com/your-namespace/agile-project-ui:chosen-version
```

This uploads to your chosen registry and requires its permission. A local pull/tag/push copies the selected platform, not necessarily a multi-platform index; use a registry-copy tool that preserves all manifests if distributing every architecture. Keep MIT, dependency and runtime notices intact, verify the destination digest/platforms, and set `AGILE_IMAGE` to the resulting reference. No Docker Hub publication is implied.

For underlying Docker behavior, see the official [Compose service reference](https://docs.docker.com/reference/compose-file/services/) and [bind-mount documentation](https://docs.docker.com/engine/storage/bind-mounts/).
