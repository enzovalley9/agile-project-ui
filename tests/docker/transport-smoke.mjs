import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'agile-transport-server-')));
const fixtureImage = `agile-project-ui:ssh-test-${randomUUID()}`;
const docker = (...args) =>
  execute('docker', args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
let container;
try {
  // Reuse the compiler cache from the image build. The SSH server is never shipped.
  await docker('build', '--target', 'openssh-client-build', '--tag', fixtureImage, '.');
  container = (await docker('create', fixtureImage)).stdout.trim();
  const mounts = [];
  for (const serverPath of [
    '/usr/local/sbin/sshd',
    '/usr/local/libexec/sshd-session',
    '/usr/local/libexec/sshd-auth',
  ]) {
    const file = join(directory, serverPath.split('/').at(-1));
    await docker('cp', `${container}:${serverPath}`, file);
    mounts.push('--mount', `type=bind,source=${file},target=${serverPath},readonly`);
  }
  const result = await docker(
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '0:0',
    '--entrypoint',
    'node',
    ...mounts,
    '--mount',
    `type=bind,source=${resolve('tests/docker/transport-fixture.mjs')},target=/transport-fixture.mjs,readonly`,
    process.env.AGILE_DOCKER_IMAGE ?? 'agile-project-ui:local',
    '/transport-fixture.mjs',
  );
  console.log(`Runtime Git transport: ${result.stdout.trim()}`);
} finally {
  if (container) await docker('rm', container);
  await docker('image', 'rm', fixtureImage).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
