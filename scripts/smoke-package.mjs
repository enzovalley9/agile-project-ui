import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const name = `bmad-project-ui-connectors-${process.platform}-${process.arch}`;
const archive = path.resolve(process.argv[2] || `dist/artifacts/${name}.tar.gz`);
const root = await fs.mkdtemp(path.join(tmpdir(), 'bmad-package-smoke-'));
const source = path.join(root, name),
  destination = path.join(root, 'user install', 'connectors');
const runtime = path.join(source, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const installer = path.join(source, 'install-connectors.mjs');
const options = { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true };
const command = (file, args) => {
  if (process.platform !== 'win32' || !file.endsWith('.cmd')) return { file, args, options };
  // This test controls every value. CMD's /s requires the outer quotation pair;
  // disabling delayed expansion preserves literal exclamation marks in paths.
  const values = [file, ...args];
  assert(values.every((value) => !/["%\r\n]/.test(value)));
  return {
    file: 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', `"${values.map((value) => `"${value}"`).join(' ')}"`],
    options: { ...options, windowsVerbatimArguments: true },
  };
};
const invoke = async (file, args) => {
  const call = command(file, args);
  return exec(call.file, call.args, call.options);
};
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function startedConnector(launcher, args, port) {
  const call = command(launcher, args);
  const child = spawn(call.file, call.args, {
    ...call.options,
    timeout: undefined,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  let done = false;
  const closed = new Promise((resolve) => {
    child.once('close', () => {
      done = true;
      resolve();
    });
    child.once('error', () => {
      done = true;
      resolve();
    });
  });
  const stop = async () => {
    if (!done && child.pid) {
      if (process.platform === 'win32')
        await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], options).catch(
          () => undefined,
        );
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* already stopped */
        }
      }
    }
    await Promise.race([closed, pause(5000)]);
    if (!done && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already stopped */
      }
      await Promise.race([closed, pause(1000)]);
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    assert.equal(response, null, 'The installed connector listener stopped.');
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (done) throw new Error('Installed connector exited before becoming ready.');
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        signal: AbortSignal.timeout(300),
      }).catch(() => null);
      if (response?.ok) return { stop, health: await response.json() };
      await pause(50);
    }
    throw new Error('Installed connector did not become ready.');
  } catch (error) {
    await stop();
    throw error;
  }
}
async function nativeConnectorSmoke(launcher) {
  const repo = path.join(root, 'native project');
  await fs.mkdir(repo);
  await exec('git', ['init', '-b', 'main', repo], options);
  const privateDirectory = path.join(root, 'private');
  await fs.mkdir(privateDirectory, { mode: 0o700 });
  const common = await fs.realpath(path.join(repo, '.git'));
  const nativeJournal = path.join(
    homedir(),
    '.bmad-project-ui',
    'git-connector',
    createHash('sha256').update(common).digest('hex'),
  );
  await assert.rejects(fs.lstat(nativeJournal), { code: 'ENOENT' }); // Never clean a pre-existing journal.
  const origin = 'http://127.0.0.1:5173',
    port = await unusedPort(),
    tokenFile = path.join(privateDirectory, 'git-capability');
  let running;
  try {
    running = await startedConnector(
      launcher,
      [
        'git',
        '--repo',
        repo,
        '--origin',
        origin,
        '--port',
        String(port),
        '--token-file',
        tokenFile,
      ],
      port,
    );
    assert.equal(running.health.protocol, 1);
    const base = `http://127.0.0.1:${port}`;
    assert.equal(
      (await fetch(base + '/v1/repository', { headers: { Origin: origin } })).status,
      401,
    );
    const token = (await fs.readFile(tokenFile, 'utf8')).trim();
    assert(token.length >= 32);
    const request = async (route, body, binding) => {
      const response = await fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          Authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(binding ? { 'X-BMAD-Binding': binding } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200, `Installed Git route ${route}`);
      return response.json();
    };
    await request('/v1/session', { trustRepository: true });
    const challenge = await request('/v1/bindings/challenge', {});
    assert.match(challenge.path, /^\.bmad-project-ui\/local\/git-bindings\/[a-f0-9-]{36}\.json$/);
    const marker = path.join(repo, challenge.path);
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, challenge.content);
    const binding = await request('/v1/bindings/verify', { id: challenge.id });
    await fs.unlink(marker);
    const repository = await request('/v1/repository', undefined, binding.bindingId);
    assert.equal(repository.rootName, 'native project');
    assert.equal(repository.branch, 'main');
  } finally {
    await running?.stop();
    await fs.rmdir(nativeJournal).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  const atlassianPort = await unusedPort(),
    credentials = path.join(privateDirectory, 'fixture-credentials.json');
  await fs.writeFile(
    credentials,
    JSON.stringify({ authorization: 'Bearer smoke-fixture-not-a-provider-credential' }),
    { mode: 0o600 },
  );
  running = await startedConnector(
    launcher,
    [
      'atlassian',
      '--provider',
      'jira',
      '--deployment',
      'cloud',
      '--instance',
      'https://example.invalid',
      '--origin',
      origin,
      '--port',
      String(atlassianPort),
      '--token-file',
      path.join(privateDirectory, 'atlassian-capability'),
      '--credentials-file',
      credentials,
      '--journal-directory',
      path.join(privateDirectory, 'atlassian-journal'),
    ],
    atlassianPort,
  );
  try {
    assert.equal(running.health.provider, 'jira');
    const response = await fetch(`http://127.0.0.1:${atlassianPort}/v1/scopes`, {
      headers: { Origin: origin },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 401);
  } finally {
    await running.stop();
  }
}
try {
  await exec('tar', ['-xzf', archive, '-C', root], options);
  const fault = path.join(root, 'copy-fault.mjs');
  await fs.writeFile(
    fault,
    "import {promises as fs} from 'node:fs'; const original = fs.copyFile; let count = 0; fs.copyFile = async (...args) => { if (++count === 2) throw new Error('Simulated interrupted copy'); return original(...args); };\n",
  );
  await assert.rejects(
    exec(
      runtime,
      ['--import', pathToFileURL(fault).href, installer, '--destination', destination],
      options,
    ),
    /Simulated interrupted copy/,
  );
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
  assert.deepEqual(
    await fs.readdir(path.dirname(destination)),
    [],
    'A failed install leaves no final directory, lock or staging copy.',
  );
  const installWrapper = path.join(
    source,
    process.platform === 'win32'
      ? 'install.cmd'
      : process.platform === 'darwin'
        ? 'install.command'
        : 'install.sh',
  );
  await invoke(installWrapper, ['--destination', destination]);
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.arch, process.arch);
  const notices = await fs.readFile(path.join(destination, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.equal(notices, await fs.readFile('THIRD_PARTY_NOTICES.md', 'utf8'));
  assert.match(notices, /hono@/);
  assert.match(notices, /Permission is hereby granted/);
  assert(manifest.files.some((entry) => entry.path === 'THIRD_PARTY_NOTICES.md'));
  assert(manifest.files.some((entry) => entry.path === 'LICENSE'));
  assert.equal(
    await fs.readFile(path.join(destination, 'LICENSE'), 'utf8'),
    await fs.readFile('LICENSE', 'utf8'),
  );
  assert.equal(manifest.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  assert.equal(
    manifest.revision,
    (await exec('git', ['rev-parse', 'HEAD'], options)).stdout.trim(),
  );

  const launcher = path.join(
    destination,
    process.platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors',
  );
  assert.match((await invoke(launcher, ['--help'])).stdout, /Usage:/);
  assert.match((await invoke(launcher, ['git', '--help'])).stdout, /--token-file/);
  await nativeConnectorSmoke(launcher);
  await fs.writeFile(path.join(destination, 'preserve.txt'), 'Existing installation stays intact');
  await assert.rejects(invoke(installWrapper, ['--destination', destination]), /already exists/);
  assert.equal(
    await fs.readFile(path.join(destination, 'preserve.txt'), 'utf8'),
    'Existing installation stays intact',
  );
  // Only the disposable installed smoke fixture is changed to observe exact argv.
  await fs.writeFile(
    path.join(destination, 'connectors', 'git.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
  );
  const forwarded = [
    'one',
    'space in value',
    'ampersand & literal',
    'bang!literal',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ];
  assert.deepEqual(JSON.parse((await invoke(launcher, ['git', ...forwarded])).stdout), forwarded);
  await fs.writeFile(path.join(source, 'connectors', 'git.mjs'), 'corrupted package');
  const rejectedDestination = path.join(root, 'rejected');
  await assert.rejects(
    invoke(installWrapper, ['--destination', rejectedDestination]),
    /checksum failed/,
  );
  await assert.rejects(fs.lstat(rejectedDestination), { code: 'ENOENT' });
  process.stdout.write(
    `Package smoke passed on ${process.platform}/${process.arch}: interrupted copy, verified install, installed Git session/root binding, installed Jira health/auth boundary, listener shutdown, complete launcher arguments, existing-install preservation, checksum rejection and disposable uninstall.\n`,
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
