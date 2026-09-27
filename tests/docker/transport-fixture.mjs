import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { createConnection } from 'node:net';
import path from 'node:path';

// Run only in an ephemeral test container with no external network or user data.
// Server binaries are test-only mounts; clients are those shipped in the image.
const execute = promisify(execFile);
const run = async (file, args, options = {}) =>
  (
    await execute(file, args, {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    })
  ).stdout.trim();
const directory = await mkdtemp('/home/node/agile-transport-');
const git = (...args) => run('git', args);
for (const name of ['host', 'client'])
  await run('/usr/local/bin/ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
    path.join(directory, name),
  ]);
await writeFile(
  path.join(directory, 'authorized_keys'),
  await readFile(path.join(directory, 'client.pub')),
);
await chmod(path.join(directory, 'authorized_keys'), 0o600);
await writeFile(
  path.join(directory, 'known_hosts'),
  `[127.0.0.1]:43129 ${await readFile(path.join(directory, 'host.pub'), 'utf8')}`,
);
await run('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  `${directory}/tls.key`,
  '-out',
  `${directory}/tls.crt`,
  '-days',
  '1',
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost,IP:127.0.0.1',
]);
const seed = path.join(directory, 'seed');
await git('init', '--initial-branch=main', seed);
await git('-C', seed, 'config', 'user.name', 'Transport fixture');
await git('-C', seed, 'config', 'user.email', 'fixture@example.invalid');
await writeFile(path.join(seed, 'README.md'), '# Synthetic transport fixture\n');
await git('-C', seed, 'add', 'README.md');
await git('-C', seed, 'commit', '-m', 'Seed transport fixture');
const initialHead = await git('-C', seed, 'rev-parse', 'HEAD');
for (const name of ['ssh.git', 'https.git']) {
  await git('init', '--bare', '--initial-branch=main', path.join(directory, name));
  await git('-C', seed, 'push', path.join(directory, name), 'HEAD:refs/heads/main');
  await git('--git-dir', path.join(directory, name), 'config', 'http.receivepack', 'true');
}
await run('chown', ['-R', 'node:node', directory]);
await chmod(directory, 0o700);
await mkdir('/var/empty', { recursive: true, mode: 0o755 });
// This disposable account change allows public-key auth; the server disables passwords.
await run('usermod', ['--password', 'NP', 'node']);
await writeFile(
  path.join(directory, 'sshd_config'),
  [
    'ListenAddress 127.0.0.1',
    'Port 43129',
    `HostKey ${directory}/host`,
    `PidFile ${directory}/sshd.pid`,
    `AuthorizedKeysFile ${directory}/authorized_keys`,
    'AllowUsers node',
    'PermitRootLogin no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'UsePAM no',
    'StrictModes yes',
    'LogLevel VERBOSE',
  ].join('\n') + '\n',
);
const sshServer = spawn('/usr/local/sbin/sshd', ['-D', '-e', '-f', `${directory}/sshd_config`], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
let sshLog = '';
sshServer.stderr.on('data', (chunk) => {
  sshLog = (sshLog + chunk).slice(-8192);
});
let cgiError;
let redirectRequests = 0;
let legacyRequests = 0;
let xmlRequests = 0;
const httpsServer = createServer(
  { key: await readFile(`${directory}/tls.key`), cert: await readFile(`${directory}/tls.crt`) },
  async (request, response) => {
    try {
      const url = new URL(request.url, 'https://localhost');
      if (url.pathname.startsWith('/redirect.git/')) {
        redirectRequests++;
        response.writeHead(302, { Location: 'ftp://127.0.0.1:1/unsupported.git/info/refs' });
        response.end();
        return;
      }
      if (url.pathname.startsWith('/dav.git/')) {
        legacyRequests++;
        if (['PROPFIND', 'LOCK', 'MKCOL', 'PUT', 'DELETE'].includes(request.method)) xmlRequests++;
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(
          url.pathname.endsWith('/HEAD')
            ? 'ref: refs/heads/main\n'
            : `${initialHead}\trefs/heads/main\n`,
        );
        return;
      }
      assert.ok(url.pathname.startsWith('/https.git/'));
      const input = [];
      for await (const chunk of request) input.push(chunk);
      const body = Buffer.concat(input);
      assert.ok(body.length < 1024 * 1024);
      const child = spawn('/usr/lib/git-core/git-http-backend', [], {
        uid: 1000,
        gid: 1000,
        env: {
          PATH: process.env.PATH,
          HOME: '/home/node',
          GIT_PROJECT_ROOT: directory,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: request.method,
          CONTENT_TYPE: request.headers['content-type'] ?? '',
          CONTENT_LENGTH: String(body.length),
          REMOTE_USER: 'node',
          HTTP_GIT_PROTOCOL: request.headers['git-protocol'] ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = [];
      let errors = '';
      child.stdout.on('data', (chunk) => output.push(chunk));
      child.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      child.stdin.end(body);
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 0, errors);
      const bytes = Buffer.concat(output);
      assert.ok(bytes.length < 4 * 1024 * 1024);
      const separator = bytes.indexOf('\r\n\r\n');
      assert.ok(separator >= 0, 'Git CGI response must have headers');
      let status = 200;
      const headers = {};
      for (const header of bytes.subarray(0, separator).toString('utf8').split('\r\n')) {
        const index = header.indexOf(':');
        assert.ok(index > 0);
        const name = header.slice(0, index);
        const value = header.slice(index + 1).trim();
        if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      response.end(bytes.subarray(separator + 4));
    } catch (error) {
      cgiError = error;
      response.writeHead(500);
      response.end('Controlled Git fixture failed');
    }
  },
);
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: 43129 });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ready) break;
    assert.ok(attempt < 99, `SSH test server failed: ${sshLog}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => httpsServer.listen(0, '127.0.0.1', resolve));
  const httpsOrigin = `https://127.0.0.1:${httpsServer.address().port}`;
  const env = {
    PATH: process.env.PATH,
    HOME: '/home/node',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_SSL_CAINFO: `${directory}/tls.crt`,
    GIT_SSH_COMMAND: `/usr/local/bin/ssh -i ${directory}/client -o IdentitiesOnly=yes -o UserKnownHostsFile=${directory}/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes`,
  };
  const client = (...args) => run('git', args, { env, uid: 1000, gid: 1000 });
  const verified = [];
  for (const [protocol, remote] of [
    ['ssh', `ssh://node@127.0.0.1:43129${directory}/ssh.git`],
    ['https', `${httpsOrigin}/https.git`],
  ]) {
    const local = path.join(directory, `${protocol}-client`);
    await client('clone', remote, local);
    assert.equal(await client('-C', local, 'rev-parse', 'HEAD'), initialHead);
    await client('-C', local, 'config', 'user.name', 'Runtime transport fixture');
    await client('-C', local, 'config', 'user.email', 'fixture@example.invalid');
    await appendFile(path.join(local, 'README.md'), `Verified ${protocol} round trip.\n`);
    await client('-C', local, 'add', 'README.md');
    await client('-C', local, 'commit', '-m', `Verify ${protocol} transport`);
    await client('-C', local, 'push', 'origin', 'HEAD:refs/heads/main');
    const head = await client('-C', local, 'rev-parse', 'HEAD');
    assert.equal(
      (await client('-C', local, 'ls-remote', remote, 'refs/heads/main')).split(/\s/)[0],
      head,
    );
    assert.equal(
      await client(
        '--git-dir',
        path.join(directory, `${protocol}.git`),
        'rev-parse',
        'refs/heads/main',
      ),
      head,
    );
    verified.push({ protocol, clone: true, push: true, remoteSha: head });
  }
  await assert.rejects(
    client('ls-remote', `${httpsOrigin}/redirect.git`),
    /not allowed|disabled|unsupported|Protocol.*ftp|redirect.*ftp/i,
  );
  assert.ok(redirectRequests > 0, 'The HTTPS server must receive the redirect request');
  await assert.rejects(
    client(
      '-C',
      path.join(directory, 'https-client'),
      'push',
      `${httpsOrigin}/dav.git`,
      'HEAD:refs/heads/main',
    ),
    /http-push.*not a git command|unable to fork|cannot run git-http-push/i,
  );
  assert.ok(legacyRequests > 0, 'The legacy HTTP path must actually be attempted');
  assert.equal(xmlRequests, 0, 'WebDAV XML requests must never be sent');
  assert.equal(cgiError, undefined);
  console.log(
    JSON.stringify({
      verified,
      httpsToFtpRedirectBlocked: true,
      webDavHelperAbsent: true,
      webDavXmlRequests: xmlRequests,
      externalNetwork: false,
    }),
  );
} catch (error) {
  console.error(sshLog);
  throw error;
} finally {
  await new Promise((resolve) => httpsServer.close(resolve));
  sshServer.kill('SIGTERM');
  await new Promise((resolve) => {
    if (sshServer.exitCode !== null) resolve();
    else sshServer.once('exit', resolve);
  });
}
