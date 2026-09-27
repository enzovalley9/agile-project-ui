import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function inventory(text) {
  const packages = text
    .trim()
    .split('\n')
    .map((line) => {
      const [name, version, architecture, source, sourceVersion] = line.split('\t');
      assert.match(name ?? '', /^[a-z0-9][a-z0-9+.-]+(?::[a-z0-9]+)?$/);
      assert.match(source ?? '', /^[a-z0-9][a-z0-9+.-]+$/);
      for (const value of [version, sourceVersion])
        assert.match(value ?? '', /^[a-zA-Z0-9.+:~\-]+$/);
      assert.match(architecture ?? '', /^[a-z0-9-]+$/);
      return { name, version, architecture, source, sourceVersion };
    });
  assert.equal(new Set(packages.map(({ name }) => name)).size, packages.length);
  return packages.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function sourceChecksums(dsc, name, version) {
  assert.equal(/^Source: (.+)$/m.exec(dsc)?.[1], name, 'Source package identity mismatch');
  assert.equal(/^Version: (.+)$/m.exec(dsc)?.[1], version, 'Source package version mismatch');
  const section = /^Checksums-Sha256:\n((?: [^\n]+\n)+)/m.exec(dsc)?.[1];
  assert.ok(section, 'Source descriptor must contain SHA-256 checksums');
  return section
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*([a-f0-9]{64})\s+(\d+)\s+([A-Za-z0-9][A-Za-z0-9.+_~\-]*)$/.exec(line);
      assert.ok(match, 'Unsafe source filename or checksum');
      return { sha256: match[1], size: Number(match[2]), name: match[3] };
    });
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function distributionIdentity(text) {
  const field = (name) => {
    const value = new RegExp(`^${name}=(?:"([a-z0-9.]+)"|([a-z0-9.]+))$`, 'm').exec(text);
    assert.ok(value, `Missing distribution ${name}`);
    return value[1] ?? value[2];
  };
  return { id: field('ID'), versionId: field('VERSION_ID') };
}
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });

export async function verifySourceDirectory(directory, source, version) {
  const names = await readdir(directory);
  const descriptors = names.filter((name) => name.endsWith('.dsc'));
  assert.equal(descriptors.length, 1, 'Exactly one source descriptor is required');
  const descriptor = descriptors[0];
  const checksums = sourceChecksums(
    await readFile(path.join(directory, descriptor), 'utf8'),
    source,
    version,
  );
  const expected = [descriptor, ...checksums.map(({ name }) => name)].sort();
  assert.deepEqual(names.sort(), expected, 'Source directory contains missing or unexpected files');
  const files = [];
  for (const name of expected) {
    const filename = path.join(directory, name);
    const info = await lstat(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Source files must be regular files');
    const digest = sha256(await readFile(filename));
    const checksum = checksums.find((file) => file.name === name);
    if (checksum) {
      assert.equal(info.size, checksum.size, `Source size mismatch: ${name}`);
      assert.equal(digest, checksum.sha256, `Source checksum mismatch: ${name}`);
    }
    files.push({ name, sha256: digest, size: info.size });
  }
  return files;
}

async function download(url, maximum) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
  assert.ok(response.ok, `Source download failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= maximum, 'Source download exceeds its size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function collect(output, revision) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  await mkdir(output, { recursive: true });
  output = await realpath(output);
  const packages = inventory(
    run('dpkg-query', [
      '-W',
      '-f=${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\n',
    ]),
  );
  await mkdir(path.join(output, 'copyright'), { recursive: true });
  for (const pkg of packages) {
    const filename = pkg.name.replace(/:.+$/, '');
    // Debian allows copyright symlinks between binary packages of one source.
    const license = await realpath(`/usr/share/doc/${filename}/copyright`);
    assert.ok(license.startsWith('/usr/share/doc/'));
    await copyFile(license, path.join(output, 'copyright', `${pkg.name}.copyright`));
    pkg.copyright = `copyright/${pkg.name}.copyright`;
  }
  const sources = [
    ...new Map(
      packages.map(({ source, sourceVersion }) => [
        `${source}@${sourceVersion}`,
        { name: source, version: sourceVersion },
      ]),
    ).values(),
  ];
  for (const source of sources) {
    source.directory = `sources/${source.name}-${encodeURIComponent(source.version)}`;
    const directory = path.join(output, source.directory);
    await mkdir(directory, { recursive: true });
    console.log(`Collecting exact source: ${source.name} ${source.version}`);
    // APT checks the signed archive index and its file checksums. No package
    // installation, extraction, maintainer scripts or source build is performed.
    run(
      'apt-get',
      ['source', '--download-only', '--only-source', '--yes', `${source.name}=${source.version}`],
      { cwd: directory },
    );
    source.files = await verifySourceDirectory(directory, source.name, source.version);
  }
  const nodeVersion = process.versions.node;
  const nodeName = `node-v${nodeVersion}.tar.xz`;
  const nodeURL = `https://nodejs.org/dist/v${nodeVersion}/`;
  const sums = await download(`${nodeURL}SHASUMS256.txt`, 1024 * 1024);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .find((line) => line.endsWith(`  ${nodeName}`))
    ?.split('  ')[0];
  assert.match(expected ?? '', /^[a-f0-9]{64}$/);
  const nodeSource = await download(`${nodeURL}${nodeName}`, 256 * 1024 * 1024);
  assert.equal(sha256(nodeSource), expected);
  await mkdir(path.join(output, 'sources', 'node'), { recursive: true });
  await writeFile(path.join(output, 'sources', 'node', nodeName), nodeSource);
  await writeFile(path.join(output, 'sources', 'node', 'SHASUMS256.txt'), sums);
  sources.push({
    name: 'node',
    version: nodeVersion,
    directory: 'sources/node',
    url: nodeURL,
    files: [
      { name: nodeName, sha256: expected, size: nodeSource.length },
      { name: 'SHASUMS256.txt', sha256: sha256(sums), size: sums.length },
    ],
  });
  const opensshPath = '/opt/agile-project-ui/licenses';
  const openssh = JSON.parse(await readFile(path.join(opensshPath, 'openssh-build.json'), 'utf8'));
  assert.equal(openssh.name, 'openssh');
  assert.equal(openssh.directory, 'sources/openssh');
  await mkdir(path.join(output, openssh.directory), { recursive: true });
  for (const file of openssh.files) {
    assert.match(file.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const original = path.join(opensshPath, openssh.directory, file.name);
    const info = await lstat(original);
    assert.ok(info.isFile() && !info.isSymbolicLink());
    const bytes = await readFile(original);
    assert.equal(bytes.length, file.size);
    assert.equal(sha256(bytes), file.sha256);
    await copyFile(original, path.join(output, openssh.directory, file.name));
  }
  await copyFile(
    path.join(opensshPath, 'openssh-build.json'),
    path.join(output, 'openssh-build.json'),
  );
  sources.push(openssh);
  const distro = distributionIdentity(await readFile('/etc/os-release', 'utf8'));
  const manifest = {
    schemaVersion: 1,
    revision,
    distro,
    debianPackages: packages,
    sources,
    builtComponents: [openssh],
  };
  await writeFile(
    path.join(output, 'source-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await writeFile(
    path.join(output, 'debian-packages.tsv'),
    packages
      .map(({ name, version, architecture, source, sourceVersion }) =>
        [name, version, architecture, source, sourceVersion].join('\t'),
      )
      .join('\n') + '\n',
  );
  const checksumLines = sources.flatMap(({ directory, files }) =>
    files.map(({ name, sha256 }) => `${sha256}  ${directory}/${name}`),
  );
  for (const name of [
    'source-manifest.json',
    'openssh-build.json',
    'debian-packages.tsv',
    ...packages.map(({ copyright }) => copyright),
  ])
    checksumLines.push(`${sha256(await readFile(path.join(output, name)))}  ${name}`);
  await writeFile(path.join(output, 'SHA256SUMS'), checksumLines.sort().join('\n') + '\n');
  console.log(
    `Verified ${packages.length} Debian binaries, ${sources.length} corresponding source packages.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collect(process.argv[2], process.env.AGILE_PROJECT_UI_BUILD_REVISION).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
