import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';

// This controlled fixture runs only in the isolated compiler stage. Its server,
// ephemeral keys, user change and repositories never enter the runtime image.
const directory = await mkdtemp('/home/node/agile-ssh-fixture-');
const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
for (const name of ['host', 'client'])
  run('/openssh-output/bin/ssh-keygen', [
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
await writeFile(
  path.join(directory, 'known_hosts'),
  `[127.0.0.1]:43129 ${await readFile(path.join(directory, 'host.pub'), 'utf8')}`,
);
run('git', ['init', '--bare', '--initial-branch=main', path.join(directory, 'remote.git')]);
run('chown', ['-R', 'node:node', directory]);
await chmod(directory, 0o700);
// Enable public-key login for this disposable fixture account; passwords stay disabled.
run('usermod', ['--password', 'NP', 'node']);
await writeFile(
  path.join(directory, 'sshd_config'),
  [
    'ListenAddress 127.0.0.1',
    'Port 43129',
    `HostKey ${directory}/host`,
    `PidFile ${directory}/pid`,
    `AuthorizedKeysFile ${directory}/authorized_keys`,
    'AllowUsers node',
    'PermitRootLogin no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'UsePAM no',
    'StrictModes yes',
    'LogLevel ERROR',
  ].join('\n') + '\n',
);
const server = spawn(
  '/usr/local/sbin/sshd',
  ['-D', '-e', '-f', path.join(directory, 'sshd_config')],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let diagnostics = '';
server.stderr.on('data', (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-4096);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: 43129 });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `SSH fixture failed to start: ${diagnostics}`);
  const local = path.join(directory, 'local');
  run('git', ['init', '--initial-branch=main', local]);
  run('git', ['-C', local, 'config', 'user.name', 'SSH transport fixture']);
  run('git', ['-C', local, 'config', 'user.email', 'fixture@example.invalid']);
  await writeFile(path.join(local, 'README.md'), '# Controlled SSH transport fixture\n');
  run('git', ['-C', local, 'add', 'README.md']);
  run('git', ['-C', local, 'commit', '-m', 'Verify fixed OpenSSH Git transport']);
  const remote = `ssh://node@127.0.0.1:43129${directory}/remote.git`;
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: `/openssh-output/bin/ssh -i ${directory}/client -o UserKnownHostsFile=${directory}/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes`,
  };
  run('git', ['-C', local, 'push', remote, 'HEAD:refs/heads/main'], { env });
  const head = run('git', ['-C', local, 'rev-parse', 'HEAD']);
  assert.equal(
    run('git', ['-C', local, 'ls-remote', remote, 'refs/heads/main'], { env }).split(/\s/)[0],
    head,
  );
  console.log(
    'Fixed OpenSSH client: host-key verification, public-key authentication, Git push and remote SHA verification passed.',
  );
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once('exit', resolve);
  });
}
