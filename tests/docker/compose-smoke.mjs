import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const distribution = await exec(
  'docker',
  [
    'run',
    '--rm',
    '--read-only',
    '--network',
    'none',
    '--cap-drop=ALL',
    '--entrypoint',
    'node',
    process.env.AGILE_DOCKER_IMAGE ?? 'agile-project-ui:local',
    'docker/verify-distribution.mjs',
  ],
  { timeout: 120_000 },
);
console.log(distribution.stdout.trim());
await import('./transport-smoke.mjs');
const root = await realpath(await mkdtemp(join(tmpdir(), 'agile-compose-')));
const project = join(root, 'project');
await mkdir(project, { mode: 0o700 });
await exec('git', ['init', '-b', 'main', project]);
const env = {
  ...process.env,
  AGILE_IMAGE: process.env.AGILE_DOCKER_IMAGE ?? 'agile-project-ui:local',
  AGILE_UID: String(process.getuid?.() ?? 1000),
  AGILE_GID: String(process.getgid?.() ?? 1000),
  AGILE_PROJECT_DIR: project,
  AGILE_GIT_ALLOW_MAPPED_OWNERSHIP: '1',
};
for (const provider of ['git', 'jira', 'confluence']) {
  const state = join(root, provider);
  await mkdir(state, { mode: 0o700 });
  await chmod(state, 0o700);
  env[`AGILE_${provider.toUpperCase()}_STATE_DIR`] = state;
  if (provider !== 'git') {
    const file = join(root, `${provider}.json`);
    await writeFile(file, JSON.stringify({ bearerToken: 'synthetic-offline-fixture' }), {
      mode: 0o600,
    });
    env[`AGILE_${provider.toUpperCase()}_CREDENTIALS_FILE`] = file;
    env[`AGILE_${provider.toUpperCase()}_INSTANCE`] = 'https://example.atlassian.net';
  }
}
const prefix = [
  'compose',
  '--file',
  resolve('compose.yaml'),
  '--project-name',
  `agile-test-${randomUUID()}`,
];
const compose = (...args) => exec('docker', [...prefix, ...args], { env, maxBuffer: 2 ** 20 });
const config = JSON.parse((await compose('--profile', '*', 'config', '--format', 'json')).stdout);
assert.deepEqual(Object.keys(config.services).sort(), ['confluence', 'git', 'jira', 'web']);
for (const service of Object.values(config.services)) {
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert(service.security_opt.includes('no-new-privileges:true'));
  assert(service.ports.every((port) => port.host_ip === '127.0.0.1'));
  assert.equal(service.user, `${env.AGILE_UID}:${env.AGILE_GID}`);
  // Compose versions differ in whether their normalized JSON retains false values.
  for (const volume of service.volumes ?? []) assert.notEqual(volume.bind?.create_host_path, true);
}
assert.equal(config.services.web.volumes, undefined);
for (const provider of ['jira', 'confluence']) {
  const mounts = config.services[provider].volumes;
  assert(!mounts.some((volume) => volume.target === '/workspace'));
  assert(mounts.find((volume) => volume.target === '/run/secrets/credentials.json').read_only);
}
try {
  const missingState = join(root, 'must-not-be-created');
  await assert.rejects(
    exec('docker', [...prefix, '--profile', 'git', 'run', '--rm', '--no-deps', 'git'], {
      env: { ...env, AGILE_GIT_STATE_DIR: missingState },
      timeout: 20_000,
      maxBuffer: 2 ** 20,
    }),
    /bind source path does not exist|invalid mount config for type "bind"/,
  );
  await assert.rejects(access(missingState), { code: 'ENOENT' });
  await compose('up', '--detach', '--wait', '--wait-timeout', '90');
  let running = (await compose('ps', '--services', '--status', 'running')).stdout
    .trim()
    .split('\n');
  assert.deepEqual(running, ['web'], 'Connectors must be opt-in');
  await compose('--profile', '*', 'up', '--detach', '--wait', '--wait-timeout', '90');
  running = (await compose('ps', '--services', '--status', 'running')).stdout.trim().split('\n');
  assert.deepEqual(running.sort(), ['confluence', 'git', 'jira', 'web']);
  for (const [port, path] of [
    [8080, '/healthz'],
    [43120, '/v1/health'],
    [43121, '/v1/health'],
    [43122, '/v1/health'],
  ]) {
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200);
  }
  console.log(
    'Compose: web-only default, all optional profiles healthy, private mounts and loopback mappings verified. No provider requests were made.',
  );
} finally {
  await compose('--profile', '*', 'down', '--timeout', '10');
}
