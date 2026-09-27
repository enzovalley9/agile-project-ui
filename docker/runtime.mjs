import { access, lstat, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWebServer } from './web-server.mjs';

const imageRoot = fileURLToPath(new URL('..', import.meta.url));
export const ports = Object.freeze({ web: 8080, git: 43120, jira: 43121, confluence: 43122 });

function absolutePath(value, label) {
  if (!value || !path.isAbsolute(value) || /[\0\r\n]/.test(value))
    throw new Error(`${label} must be an absolute container path.`);
  return path.resolve(value);
}

export function runtimeConfiguration(mode = 'web', env = process.env) {
  if (!Object.hasOwn(ports, mode)) throw new Error('Choose web, git, jira or confluence.');
  const origin = env.AGILE_WEB_ORIGIN ?? 'http://127.0.0.1:8080';
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('AGILE_WEB_ORIGIN must be an exact HTTP(S) origin.');
  }
  if (
    url.origin !== origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('AGILE_WEB_ORIGIN must be an exact HTTPS origin or HTTP loopback origin.');
  if (mode === 'web') return { mode, port: ports.web, origin };
  const state = absolutePath(env.AGILE_STATE_DIR ?? '/state', 'AGILE_STATE_DIR');
  const args = [
    '--origin',
    origin,
    '--listen-host',
    '0.0.0.0',
    '--port',
    String(ports[mode]),
    '--token-file',
    path.join(state, `${mode}-token`),
  ];
  if (mode === 'git') {
    const mappedOwnership = env.AGILE_GIT_ALLOW_MAPPED_OWNERSHIP ?? '0';
    if (!['0', '1'].includes(mappedOwnership))
      throw new Error('AGILE_GIT_ALLOW_MAPPED_OWNERSHIP must be 0 or 1.');
    if (mappedOwnership === '1') args.push('--allow-mapped-ownership', 'true');
    const repo = absolutePath(env.AGILE_REPO_PATH ?? '/workspace', 'AGILE_REPO_PATH');
    if (state === repo || state.startsWith(repo + path.sep))
      throw new Error('AGILE_STATE_DIR must be outside the repository.');
    args.push('--repo', repo, '--state-directory', path.join(state, 'journal', 'git'));
  } else {
    const instance = env.AGILE_ATLASSIAN_INSTANCE;
    let parsed;
    try {
      parsed = new URL(instance);
    } catch {
      throw new Error('AGILE_ATLASSIAN_INSTANCE must be the provider HTTPS base URL.');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        'AGILE_ATLASSIAN_INSTANCE must be an HTTPS base URL without credentials or a query.',
      );
    const deployment = env.AGILE_ATLASSIAN_DEPLOYMENT ?? 'cloud';
    if (!['cloud', 'data-center'].includes(deployment))
      throw new Error('AGILE_ATLASSIAN_DEPLOYMENT must be cloud or data-center.');
    const credentials = absolutePath(
      env.AGILE_CREDENTIALS_FILE ?? '/run/secrets/credentials.json',
      'AGILE_CREDENTIALS_FILE',
    );
    args.push(
      '--provider',
      mode,
      '--deployment',
      deployment,
      '--instance',
      instance,
      '--credentials-file',
      credentials,
      '--journal-directory',
      path.join(state, 'journal', mode),
    );
  }
  return { mode, port: ports[mode], origin, state, args };
}

export async function requirePrivateState(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(directory)) !== directory ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error(
      'AGILE_STATE_DIR must be a private directory (0700) accessible to the runtime user; check the bind mount UID.',
    );
  // Docker Desktop can translate bind-mount ownership while reporting uid 0.
  // Check effective access as well as private mode, rather than trusting stat.uid.
  await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length > 1) throw new Error('Pass exactly one service: web, git, jira or confluence.');
  const config = runtimeConfiguration(args[0], env);
  if (config.mode === 'web') {
    const server = await startWebServer({
      root: path.join(imageRoot, 'web'),
      port: config.port,
      origin: config.origin,
    });
    console.log(
      `Agile Project UI listening on 0.0.0.0:${config.port}. Publish this port on host loopback only.`,
    );
    return server;
  }
  process.umask(0o077);
  await requirePrivateState(config.state);
  if (config.mode === 'git') {
    const { startGitConnector } = await import('../connectors/git.mjs');
    return startGitConnector(config.args);
  }
  const { main: startAtlassian } = await import('../connectors/atlassian.mjs');
  return startAtlassian(config.args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Configuration can contain credentials or private paths. Never echo it.
    console.error(
      'Agile Project UI could not start. Check the service, environment, mounted paths, private permissions and runtime UID.',
    );
    process.exitCode = 1;
  });
}
