import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const root = '/opt/agile-project-ui/licenses';
const manifest = JSON.parse(await readFile(path.join(root, 'source-manifest.json'), 'utf8'));
const installed = execFileSync(
  'dpkg-query',
  [
    '-W',
    '-f=${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\n',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .sort();
const inventoried = manifest.debianPackages
  .map(({ name, version, architecture, source, sourceVersion }) =>
    [name, version, architecture, source, sourceVersion].join('\t'),
  )
  .sort();
assert.deepEqual(
  inventoried,
  installed,
  'Every installed binary must have a matching source inventory',
);
assert.match(manifest.revision, /^[a-f0-9]{40}$/);
for (const pkg of manifest.debianPackages)
  assert.ok(
    manifest.sources.some(
      ({ name, version }) => name === pkg.source && version === pkg.sourceVersion,
    ),
    `Missing source for ${pkg.name}`,
  );
assert.ok(
  manifest.sources.some(
    ({ name, version }) => name === 'node' && version === process.versions.node,
  ),
);
let files = 0;
const covered = new Set();
for (const line of (await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
  const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
  assert.ok(match);
  assert.ok(!covered.has(match[2]), 'Duplicate checksum entry');
  covered.add(match[2]);
  const file = path.resolve(root, match[2]);
  assert.ok(file.startsWith(root + path.sep));
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(await realpath(file), file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest('hex'), match[1], `Distribution checksum mismatch: ${match[2]}`);
  files++;
}
const expected = new Set([
  'source-manifest.json',
  'openssh-build.json',
  'debian-packages.tsv',
  'Node.js-LICENSE',
  'base-tools.tar.gz',
  'container.cdx.json',
  'npm-build.cdx.json',
  ...manifest.debianPackages.map(({ copyright }) => copyright),
  ...manifest.sources.flatMap(({ directory, files }) =>
    files.map(({ name }) => `${directory}/${name}`),
  ),
]);
assert.deepEqual(
  covered,
  expected,
  'Every supplied source and inventory file must be covered by checksums',
);
assert.equal(manifest.builtComponents.length, 1);
for (const component of manifest.builtComponents) {
  assert.deepEqual(component.binaries.map(({ path: file }) => path.basename(file)).sort(), [
    'scp',
    'sftp',
    'ssh',
    'ssh-add',
    'ssh-agent',
    'ssh-keygen',
    'ssh-keyscan',
  ]);
  assert.equal(component.name, 'openssh');
  for (const binary of component.binaries) {
    assert.match(binary.path, /^\/usr\/local\/bin\/[a-z-]+$/);
    const hash = createHash('sha256')
      .update(await readFile(binary.path))
      .digest('hex');
    assert.equal(hash, binary.sha256, `Built client differs from source build: ${binary.path}`);
  }
  const version = spawnSync('/usr/local/bin/ssh', ['-V'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.ok(version.stderr.startsWith(`OpenSSH_${component.version},`));
}
for (const absent of [
  '/usr/bin/ssh',
  '/usr/bin/scp',
  '/usr/bin/sftp',
  '/usr/sbin/sshd',
  '/usr/local/sbin/sshd',
  '/usr/lib/git-core/git-http-push',
  '/usr/bin/infocmp',
]) {
  await assert.rejects(lstat(absent), { code: 'ENOENT' });
}
assert.equal(
  execFileSync(
    'find',
    ['/usr', '-xdev', '-type', 'f', '(', '-perm', '-4000', '-o', '-perm', '-2000', ')', '-print'],
    { encoding: 'utf8' },
  ).trim(),
  '',
  'Runtime must not contain setuid/setgid files',
);
const removedModule = spawnSync('perl', ['-MArchive::Tar', '-e', 'exit 0'], { encoding: 'utf8' });
assert.notEqual(removedModule.status, 0, 'Archive::Tar must not be loadable');
assert.match(removedModule.stderr, /Can't locate Archive\/Tar\.pm/);
assert.equal(spawnSync('infocmp', ['-V']).error?.code, 'ENOENT');
for (const name of ['container.cdx.json', 'npm-build.cdx.json'])
  assert.equal(JSON.parse(await readFile(path.join(root, name), 'utf8')).bomFormat, 'CycloneDX');
const version = JSON.parse(await readFile('/opt/agile-project-ui/web/version.json', 'utf8'));
assert.equal(version.revision, manifest.revision);
console.log(
  `Offline source verification: ${manifest.debianPackages.length} Debian packages, ${manifest.sources.length} source packages, ${files} verified files, matching web revision.`,
);
