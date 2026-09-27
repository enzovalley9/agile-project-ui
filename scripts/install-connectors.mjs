import { promises as fs, constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const inside = (root, child) => child === root || child.startsWith(root + path.sep);
async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--destination' || !path.isAbsolute(args[1])))
  throw new Error('Usage: install [--destination ABSOLUTE_DIRECTORY]');
const defaultDirectory =
  process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
        'BMAD Project UI',
        'connectors',
      )
    : process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support', 'BMAD Project UI', 'connectors')
      : path.join(
          process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'),
          'bmad-project-ui',
          'connectors',
        );
const destination = path.resolve(args[1] || defaultDirectory);

async function install() {
  if (inside(source, destination) || inside(destination, source))
    throw new Error('Choose an installation folder separate from the extracted package.');
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.nodeVersion !== process.versions.node ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !Array.isArray(manifest.files)
  )
    throw new Error(
      'This package does not match the running bundled runtime, platform or architecture.',
    );
  const launcher = process.platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors';
  const installer =
    process.platform === 'win32'
      ? 'install.cmd'
      : process.platform === 'darwin'
        ? 'install.command'
        : 'install.sh';
  const required = new Set([
    `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
    'runtime/LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'connectors/git.mjs',
    'connectors/atlassian.mjs',
    'runtime-checksum.json',
    'launch-connectors.mjs',
    'install-connectors.mjs',
    launcher,
    installer,
    'README.txt',
  ]);
  const optional = new Set(['LICENSE']);
  for (const entry of manifest.files) {
    if (
      !entry ||
      (!required.delete(entry.path) && !optional.delete(entry.path)) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      ![0o644, 0o755].includes(entry.mode)
    )
      throw new Error('The package manifest is incomplete or invalid.');
    let cursor = source;
    for (const part of entry.path.split('/')) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error('Package symbolic links are not accepted.');
    }
    if (!(await fs.stat(cursor)).isFile() || (await digest(cursor)) !== entry.sha256)
      throw new Error(`Package checksum failed: ${entry.path}`);
  }
  if (required.size) throw new Error('The package manifest is incomplete.');
  if (await exists(destination))
    throw new Error('An installation already exists. Preserve it before installing.');
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const lock = path.join(parent, `.${path.basename(destination)}.install-lock`);
  await fs.mkdir(lock); // Exclusive directory creation serializes concurrent installers.
  let staging;
  try {
    if (await exists(destination))
      throw new Error('An installation already exists. Preserve it before installing.');
    staging = await fs.mkdtemp(path.join(parent, `.${path.basename(destination)}.staging-`));
    for (const entry of manifest.files) {
      const target = path.join(staging, entry.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(source, entry.path), target, constants.COPYFILE_EXCL);
      await fs.chmod(target, entry.mode);
      if ((await digest(target)) !== entry.sha256)
        throw new Error(`Copied package checksum failed: ${entry.path}`);
    }
    await fs.copyFile(
      path.join(source, 'manifest.json'),
      path.join(staging, 'manifest.json'),
      constants.COPYFILE_EXCL,
    );
    const runtime = path.join(
      staging,
      'runtime',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
    const { stdout } = await exec(
      runtime,
      ['-p', 'JSON.stringify([process.versions.node,process.platform,process.arch])'],
      { timeout: 15000, windowsHide: true, maxBuffer: 4096 },
    );
    if (stdout.trim() !== JSON.stringify([manifest.nodeVersion, manifest.platform, manifest.arch]))
      throw new Error('The copied runtime did not pass verification.');
    if (await exists(destination))
      throw new Error('The destination appeared during installation. It has been preserved.');
    await fs.rename(staging, destination);
    staging = undefined;
    process.stdout.write(
      `Installed at ${destination}\nNo login item, service, or network listener was started.\nRun bmad-connectors --help in that folder to connect a project.\n`,
    );
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await fs.rmdir(lock);
  }
}
install().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
