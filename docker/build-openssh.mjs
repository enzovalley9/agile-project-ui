import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = JSON.parse(await readFile('/recipe/openssh-source.json', 'utf8'));
assert.equal(source.name, 'openssh');
assert.match(source.version, /^\d+\.\d+p\d+$/);
assert.match(source.sha256, /^[a-f0-9]{64}$/);
const url = new URL(source.url);
assert.equal(url.origin, 'https://cdn.openbsd.org');
assert.equal(url.pathname, `/pub/OpenBSD/OpenSSH/portable/openssh-${source.version}.tar.gz`);
const output = '/openssh-output';
const sourceDirectory = `${output}/sources/openssh`;
await mkdir(sourceDirectory, { recursive: true });
const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
assert.ok(response.ok);
const body = Buffer.from(await response.arrayBuffer());
assert.ok(body.length < 8 * 1024 * 1024);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(body), source.sha256, 'OpenSSH source must match the upstream release checksum');
const archive = `openssh-${source.version}.tar.gz`;
await writeFile(path.join(sourceDirectory, archive), body);
const prefix = `openssh-${source.version}/`;
const entries = execFileSync('tar', ['-tzf', path.join(sourceDirectory, archive)], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');
assert.ok(
  entries.every(
    (entry) =>
      (entry === prefix.slice(0, -1) || entry.startsWith(prefix)) &&
      !entry.split('/').includes('..'),
  ),
);
await mkdir('/openssh-build', { recursive: true });
execFileSync('tar', [
  '-xzf',
  path.join(sourceDirectory, archive),
  '--strip-components=1',
  '--no-same-owner',
  '--no-same-permissions',
  '-C',
  '/openssh-build',
]);
for (const file of ['openssh-source.json', 'build-openssh.mjs', 'ssh-smoke.mjs', 'Dockerfile'])
  await copyFile(`/recipe/${file}`, path.join(sourceDirectory, file));
execFileSync('./configure', source.configure, { cwd: '/openssh-build', stdio: 'inherit' });
execFileSync('make', ['-j2'], { cwd: '/openssh-build', stdio: 'inherit' });
await copyFile('/openssh-build/LICENCE', path.join(sourceDirectory, 'LICENCE'));
await mkdir(`${output}/bin`, { recursive: true });
const binaries = [];
for (const name of source.clients) {
  assert.match(name, /^(?:ssh(?:-add|-agent|-keygen|-keyscan)?|scp|sftp)$/);
  await copyFile(`/openssh-build/${name}`, `${output}/bin/${name}`);
  await chmod(`${output}/bin/${name}`, 0o755);
  binaries.push({
    path: `/usr/local/bin/${name}`,
    sha256: hash(await readFile(`${output}/bin/${name}`)),
  });
}
const files = [];
for (const name of [
  archive,
  'openssh-source.json',
  'build-openssh.mjs',
  'ssh-smoke.mjs',
  'Dockerfile',
  'LICENCE',
]) {
  const bytes = await readFile(path.join(sourceDirectory, name));
  files.push({ name, size: bytes.length, sha256: hash(bytes) });
}
const buildPackages = execFileSync('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\n'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');
await writeFile(
  `${output}/openssh-build.json`,
  JSON.stringify(
    {
      name: source.name,
      version: source.version,
      directory: 'sources/openssh',
      url: source.url,
      files,
      binaries,
      configure: source.configure,
      buildPackages,
      artifactScope: 'Client binaries only; no SSH server is included in the runtime image.',
    },
    null,
    2,
  ) + '\n',
);
execFileSync(`${output}/bin/ssh`, ['-V'], { stdio: 'inherit' });

// Install the server only inside this compiler stage to test real SSH transport.
execFileSync('make', ['install-nokeys'], { cwd: '/openssh-build', stdio: 'inherit' });
execFileSync('node', ['/recipe/ssh-smoke.mjs'], { stdio: 'inherit' });
