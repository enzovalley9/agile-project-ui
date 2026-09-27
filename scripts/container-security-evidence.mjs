import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';

// Run only inside the exact image being scanned, with no network, no writable
// filesystem and no project/credential mounts. This prints facts, never secrets.
assert.equal(process.platform, 'linux');
assert.match(process.env.AGILE_SCAN_IMAGE_ID ?? '', /^sha256:[a-f0-9]{64}$/);
const manifest = JSON.parse(
  await readFile('/opt/agile-project-ui/licenses/source-manifest.json', 'utf8'),
);
const npmInventory = JSON.parse(
  await readFile('/opt/agile-project-ui/licenses/npm-build.cdx.json', 'utf8'),
);
assert.equal(npmInventory.bomFormat, 'CycloneDX');
assert(Array.isArray(npmInventory.components) && npmInventory.components.length > 0);
const nodePackages = [npmInventory.metadata?.component, ...npmInventory.components].map((item) => {
  assert(item?.purl?.startsWith('pkg:npm/'), 'Missing npm component identity.');
  assert(typeof item.name === 'string' && typeof item.version === 'string');
  return { name: item.group ? `${item.group}/${item.name}` : item.name, version: item.version };
});
const paths = [
  '/usr/bin/curl',
  '/usr/local/bin/curl',
  '/usr/bin/ssh',
  '/usr/bin/scp',
  '/usr/bin/sftp',
  '/usr/sbin/sshd',
  '/usr/local/sbin/sshd',
  '/usr/lib/git-core/git-http-push',
  '/usr/bin/infocmp',
  '/usr/lib/systemd/systemd-homed',
];
// Debian retains removed files in its package manifest, so inspect the exact
// recorded module paths as well as proving that Perl cannot load the module.
const archivePaths = spawnSync('dpkg-query', ['-S', '*/Archive/Tar.pm'], {
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 16384,
});
assert.equal(archivePaths.status, 0, 'Missing Archive::Tar package file inventory.');
const archiveTarPaths = archivePaths.stdout
  .trim()
  .split('\n')
  .map((line) => {
    const path = line.slice(line.indexOf(': ') + 2);
    assert(
      /^\/usr\/share\/perl\/[^/]+\/Archive\/Tar\.pm$/.test(path),
      'Unexpected Archive::Tar package path.',
    );
    return path;
  });
assert(archiveTarPaths.length > 0);
paths.push(...archiveTarPaths);
const archiveTar = spawnSync('perl', ['-MArchive::Tar', '-e', 'exit 0'], {
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 16384,
});
assert.equal(archiveTar.status, 2, 'Archive::Tar must be unavailable.');
assert.match(
  archiveTar.stderr,
  /Can't locate Archive\/Tar\.pm in @INC/,
  'Module probe failed for an unexpected reason.',
);
const pathPresence = {};
for (const path of paths) {
  try {
    await lstat(path);
    pathPresence[path] = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    pathPresence[path] = false;
  }
}
const privilegedExecutables = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile() && (await lstat(path)).mode & 0o6000) privilegedExecutables.push(path);
  }
}
await inspect('/usr');
let fstab = '';
try {
  fstab = await readFile('/etc/fstab', 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const userFstabMounts = fstab.split(/\r?\n/).filter((line) => {
  if (/^\s*(#|$)/.test(line)) return false;
  return line
    .trim()
    .split(/\s+/)[3]
    ?.split(',')
    .some((option) => ['user', 'users', 'owner', 'group'].includes(option));
}).length;
const openssh = manifest.builtComponents?.find((component) => component.name === 'openssh');
assert(
  openssh && Array.isArray(openssh.binaries),
  'Missing independently built OpenSSH component evidence.',
);
const binaries = [];
for (const binary of openssh.binaries) {
  assert(
    /^\/usr\/local\/(bin|libexec)\/[a-z0-9-]+$/.test(binary.path),
    'Unexpected built-component binary path.',
  );
  assert((await lstat(binary.path)).isFile(), 'Built component must be a regular file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(binary.path)) hash.update(chunk);
  binaries.push({ path: binary.path, sha256: hash.digest('hex') });
}
const ssh = spawnSync('/usr/local/bin/ssh', ['-V'], {
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 4096,
});
assert.equal(ssh.status, 0, 'Could not inspect the actual OpenSSH client version.');
const inventory = spawnSync(
  'dpkg-query',
  ['-W', '-f=${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n'],
  { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 },
);
assert.equal(inventory.status, 0, 'Could not inspect installed runtime packages.');
const installedPackages = inventory.stdout
  .trim()
  .split('\n')
  .map((line) => line.split('\t'))
  .filter((fields) => fields[3] === 'installed')
  .map(([name, version, architecture]) => ({ name, version, architecture }));
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      imageID: process.env.AGILE_SCAN_IMAGE_ID,
      revision: manifest.revision,
      uid: process.getuid(),
      sourceManifest: { distro: manifest.distro, builtComponents: manifest.builtComponents },
      opensshVersion: (ssh.stdout + ssh.stderr).trim(),
      binaries,
      installedPackages,
      nodePackages,
      pathPresence,
      archiveTar: { packagePaths: archiveTarPaths, unavailable: true },
      privilegedExecutables: privilegedExecutables.sort(),
      userFstabMounts,
    },
    null,
    2,
  ),
);
