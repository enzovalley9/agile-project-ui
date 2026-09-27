import { spawn, execFile } from 'node:child_process';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const usage = `Usage: agile-connectors <git|atlassian> [connector arguments]
       agile-connectors doctor [--repo ABSOLUTE_DIRECTORY] [--port PORT]
       agile-connectors setup <git|jira|confluence>
       agile-connectors --version

Doctor checks the installed package, bundled runtime, optional Git and local port.
Setup asks for paths and origin, then requires confirmation before starting.
It never asks for provider tokens. Keep credentials outside your project.
Update and rollback: run the installer from a separate extracted package with
--update|--rollback --confirm-stopped [--destination ABSOLUTE_DIRECTORY].
`;
async function manifest() {
  const value = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.files) || typeof value.version !== 'string')
    throw new Error('Package metadata is invalid. Extract a verified package again.');
  return value;
}
async function doctor(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--repo', '--port'].includes(args[i]) || !args[i + 1] || options[args[i]])
      throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  const value = await manifest();
  if (
    value.nodeVersion !== process.versions.node ||
    value.platform !== process.platform ||
    value.arch !== process.arch
  )
    throw new Error('Bundled runtime, platform or architecture does not match the package.');
  const allowed = new Set([
    'THIRD_PARTY_NOTICES.md',
    'LICENSE',
    `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
    'runtime/LICENSE',
    'connectors/git.mjs',
    'connectors/atlassian.mjs',
    'runtime-checksum.json',
    'launch-connectors.mjs',
    'install-connectors.mjs',
    process.platform === 'win32' ? 'agile-connectors.cmd' : 'agile-connectors',
    process.platform === 'win32'
      ? 'install.cmd'
      : process.platform === 'darwin'
        ? 'install.command'
        : 'install.sh',
    'README.txt',
  ]);
  for (const file of value.files) {
    if (!file || !allowed.delete(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('The package manifest is incomplete or invalid.');
    let cursor = root;
    for (const part of file.path.split('/')) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error('Package symbolic links are not accepted.');
    }
    if (!(await fs.stat(cursor)).isFile()) throw new Error('Package member is not a regular file.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(cursor)) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256)
      throw new Error(`Package checksum failed: ${file.path}`);
  }
  if (allowed.size) throw new Error('The package manifest is incomplete.');
  process.stdout.write(
    `Package: Agile Project UI ${value.version}\nSource: ${value.revision}\nRuntime: Node ${process.versions.node} on ${process.platform}/${process.arch}\nIntegrity: all ${value.files.length} package files verified\nProtocol: 1 (Git, Jira and Confluence)\n`,
  );
  try {
    const { stdout } = await exec('git', ['--version'], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 4096,
    });
    if (!/^git version [\d.]+[^\r\n]*\s*$/.test(stdout)) throw new Error();
    process.stdout.write(`Git: ${stdout.trim()}\n`);
  } catch {
    if (options['--repo'])
      throw new Error('Git is unavailable. Install Git before using the Git connector.');
    else process.stdout.write('Git: unavailable (only required for the Git connector)\n');
  }
  if (options['--repo']) {
    if (!path.isAbsolute(options['--repo'])) throw new Error('Repository path must be absolute.');
    const repo = await fs.realpath(options['--repo']);
    const { stdout } = await exec(
      'git',
      ['--no-optional-locks', '-C', repo, 'rev-parse', '--show-toplevel'],
      { timeout: 5000, windowsHide: true, maxBuffer: 8192 },
    );
    if ((await fs.realpath(stdout.trim())) !== repo)
      throw new Error('Select the repository root, not a nested directory.');
    process.stdout.write('Repository: exact Git root verified (no remote request was made)\n');
  }
  if (options['--port']) {
    const port = Number(options['--port']);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Port must be between 1024 and 65535.');
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', () =>
        reject(
          new Error(
            'The requested local port is unavailable. Stop the existing connector or choose another port.',
          ),
        ),
      );
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    process.stdout.write(`Port ${port}: available on 127.0.0.1\n`);
  }
  process.stdout.write(
    'No provider credentials were read and no remote account was contacted. Browser permissions and account access must still be checked in the app.\n',
  );
}
function exactOrigin(input) {
  const url = new URL(input);
  if (
    url.origin !== input ||
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error(
      'Use the exact HTTPS app origin, or a local HTTP origin, without a path or trailing slash.',
    );
  return input;
}
async function setup(provider) {
  if (!['git', 'jira', 'confluence'].includes(provider)) throw new Error(usage);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Guided setup needs an interactive terminal. Use --help for direct commands.');
  await doctor([]);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, fallback = '') =>
    (await prompt.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  try {
    const origin = exactOrigin(
      await ask('Web app origin', 'https://agile-project-ui.enzovalley9.workers.dev'),
    );
    const directory = await ask(
      'Private session directory outside the project',
      path.join(homedir(), '.agile-project-ui'),
    );
    if (!path.isAbsolute(directory))
      throw new Error('The private session directory must be absolute.');
    const args = ['--origin', origin, '--token-file', path.join(directory, provider + '-session')];
    if (provider === 'git') {
      const repo = await ask('Absolute repository root');
      if (!path.isAbsolute(repo)) throw new Error('The repository path must be absolute.');
      const realRepo = await fs.realpath(repo);
      const lexicalDirectory = path.resolve(directory);
      if (lexicalDirectory === realRepo || lexicalDirectory.startsWith(realRepo + path.sep))
        throw new Error('Keep the session directory outside the repository.');
      args.push('--repo', realRepo);
    } else {
      const deployment = await ask('Deployment: cloud or data-center', 'cloud');
      if (!['cloud', 'data-center'].includes(deployment))
        throw new Error('Choose cloud or data-center.');
      const instance = await ask('HTTPS provider instance');
      const url = new URL(instance);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new Error('Use an HTTPS instance without credentials, query or fragment.');
      const credentials = await ask(
        'Absolute provider credential JSON file (never enter a token here)',
        path.join(directory, provider + '-credentials.json'),
      );
      if (!path.isAbsolute(credentials))
        throw new Error('The credential file path must be absolute.');
      const stat = await fs.lstat(credentials);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 16384 ||
        (process.platform !== 'win32' && stat.mode & 0o077)
      )
        throw new Error('Use a private regular credential file (0600 on macOS/Linux).');
      args.push(
        '--provider',
        provider,
        '--deployment',
        deployment,
        '--instance',
        instance,
        '--credentials-file',
        credentials,
      );
    }
    process.stdout.write(
      `The ${provider} connector will listen on this computer. No service or login item will be installed. Keep this terminal open; stop with Ctrl+C.\n`,
    );
    if ((await ask('Start now? Type yes', 'no')).toLowerCase() !== 'yes') {
      process.stdout.write('Cancelled. No connector was started.\n');
      return;
    }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return { connector: provider === 'git' ? 'git' : 'atlassian', args };
  } finally {
    prompt.close();
  }
}
/** A PID alone can be reused. Store birth identity without logging process arguments. */
export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process identity.');
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw new Error('Cannot inspect connector process identity.');
    }
  };
  if (!alive()) return null;
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await exec(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$p = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Write($p.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture))`,
            ],
            { timeout: 10000, windowsHide: true, maxBuffer: 4096 },
          )
        : await exec('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], {
            timeout: 5000,
            maxBuffer: 4096,
            env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
          });
    const identity = stdout.trim();
    if (!identity || identity.length > 2048) throw new Error();
    return process.platform + ':' + identity;
  } catch {
    if (!alive()) return null;
    throw new Error('Cannot verify connector process birth identity. Maintenance was not applied.');
  }
}
/** Call only while holding this installation's maintenance lock. */
export async function inspectProcessLeases(installation, requireStopped) {
  const directory = installation + '.running';
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Invalid connector process registry.');
  for (const name of await fs.readdir(directory)) {
    if (!/^[1-9]\d*\.json$/.test(name))
      throw new Error('Unrecognized connector process registry entry.');
    const file = path.join(directory, name);
    const item = await fs.lstat(file);
    if (!item.isFile() || item.isSymbolicLink() || item.size > 4096)
      throw new Error('Invalid connector process registry entry.');
    const text = await fs.readFile(file, 'utf8');
    let lease;
    try {
      lease = JSON.parse(text);
    } catch {
      throw new Error('Invalid connector process registry entry.');
    }
    const pid = Number(name.slice(0, -5));
    if (
      lease.pid !== pid ||
      !Number.isSafeInteger(pid) ||
      (lease.identity !== undefined &&
        (typeof lease.identity !== 'string' || !lease.identity.startsWith(process.platform + ':')))
    )
      throw new Error('Invalid connector process registry entry.');
    const identity = await processIdentity(pid);
    if (identity === null || (lease.identity !== undefined && identity !== lease.identity)) {
      // PID reuse is stale metadata, never a reason to terminate the new process.
      if ((await fs.readFile(file, 'utf8')) !== text)
        throw new Error('Process registry changed during maintenance.');
      await fs.unlink(file);
    } else if (requireStopped)
      throw new Error(
        'A connector is still running or its legacy lease cannot prove otherwise. Stop its terminal before updating or rolling back.',
      );
  }
}
async function start(connector, args) {
  const lock = path.join(path.dirname(root), `.${path.basename(root)}.install-lock`);
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('Installation maintenance is in progress. Retry after it finishes.');
    throw error;
  }
  let child, lease, leaseText;
  let shutdownRequested = false,
    childReady = false,
    shutdownSent = false;
  const shutdown = () => {
    shutdownRequested = true;
    if (!childReady || shutdownSent) return;
    shutdownSent = true;
    // IPC provides graceful shutdown on Windows, where child.kill() terminates
    // forcibly. On Unix the child owns a separate group and cannot receive a
    // duplicate foreground-console signal before this message.
    if (child?.connected) child.send({ type: 'agile-project-ui:shutdown' }, () => {});
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    const registry = root + '.running';
    await fs.mkdir(registry, { recursive: true, mode: 0o700 });
    await inspectProcessLeases(root, false);
    child = spawn(process.execPath, [path.join(root, 'connectors', connector + '.mjs'), ...args], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      shell: false,
      windowsHide: false,
      detached: process.platform !== 'win32',
    });
    child.on('message', (value) => {
      if (value && value.type === 'agile-project-ui:ready') {
        childReady = true;
        if (shutdownRequested) shutdown();
      }
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const identity = await processIdentity(child.pid);
    if (identity !== null && child.exitCode === null && child.signalCode === null) {
      lease = path.join(registry, child.pid + '.json');
      leaseText =
        JSON.stringify({
          schemaVersion: 1,
          pid: child.pid,
          identity,
          connector,
          nonce: randomUUID(),
        }) + '\n';
      await fs.writeFile(lease, leaseText, { flag: 'wx', mode: 0o600 });
    }
    if (shutdownRequested) shutdown();
  } catch (error) {
    child?.kill();
    throw error;
  } finally {
    await fs.rmdir(lock);
  }
  try {
    const result = await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        resolve({ code: child.exitCode, signal: child.signalCode });
      else child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = result.signal ? 1 : (result.code ?? 1);
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    if (lease) {
      try {
        if ((await fs.readFile(lease, 'utf8')) === leaseText) await fs.unlink(lease);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    process.stdout.write(usage);
    return;
  }
  if (command === '--version') {
    if (args.length) throw new Error(usage);
    const value = await manifest();
    process.stdout.write(
      `Agile Project UI ${value.version} (protocol 1; ${value.platform}/${value.arch})\n`,
    );
    return;
  }
  if (command === 'doctor') return doctor(args);
  if (command === 'setup') {
    if (args.length !== 1) throw new Error(usage);
    const result = await setup(args[0]);
    if (result) await start(result.connector, result.args);
    return;
  }
  if (!['git', 'atlassian'].includes(command)) throw new Error(usage);
  return start(command, args);
}
if (process.argv[1] && (await fs.realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
