import { promises as fs, constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
const usage =
  'Usage: install [--destination ABSOLUTE_DIRECTORY] [--update|--rollback --confirm-stopped]';
let destinationArgument,
  mode = 'install',
  stopped = false;
for (let index = 0; index < args.length; index++) {
  if (
    args[index] === '--destination' &&
    !destinationArgument &&
    path.isAbsolute(args[index + 1] || '')
  )
    destinationArgument = args[++index];
  else if (['--update', '--rollback'].includes(args[index]) && mode === 'install')
    mode = args[index].slice(2);
  else if (args[index] === '--confirm-stopped' && !stopped) stopped = true;
  else throw new Error(usage);
}
if ((mode !== 'install') !== stopped)
  throw new Error(
    usage + '\nStop all connectors and explicitly confirm before an update or rollback.',
  );
const defaultDirectory =
  process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
        'Agile Project UI',
        'connectors',
      )
    : process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support', 'Agile Project UI', 'connectors')
      : path.join(
          process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'),
          'agile-project-ui',
          'connectors',
        );
const destination = path.resolve(destinationArgument || defaultDirectory);
const previous = destination + '.previous';
const launcher = process.platform === 'win32' ? 'agile-connectors.cmd' : 'agile-connectors';
const installer =
  process.platform === 'win32'
    ? 'install.cmd'
    : process.platform === 'darwin'
      ? 'install.command'
      : 'install.sh';
const runtimeName = process.platform === 'win32' ? 'node.exe' : 'node';
const packageFiles = [
  `runtime/${runtimeName}`,
  'runtime/LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
  'connectors/git.mjs',
  'connectors/atlassian.mjs',
  'runtime-checksum.json',
  'launch-connectors.mjs',
  'install-connectors.mjs',
  launcher,
  installer,
  'README.txt',
];
async function verifyPackage(root, sourceRuntime = false, exact = false) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Package folders must be regular directories.');
  if ((await fs.lstat(path.join(root, 'manifest.json'))).isSymbolicLink())
    throw new Error('Package symbolic links are not accepted.');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    (sourceRuntime && manifest.nodeVersion !== process.versions.node) ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) ||
    !/^[a-f0-9]{40}$/.test(manifest.revision) ||
    !Array.isArray(manifest.files)
  )
    throw new Error(
      'This package does not match the running bundled runtime, platform or architecture.',
    );
  const required = new Set(packageFiles);
  for (const entry of manifest.files) {
    if (
      !entry ||
      !required.delete(entry.path) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      ![0o644, 0o755].includes(entry.mode)
    )
      throw new Error('The package manifest is incomplete or invalid.');
    let cursor = root;
    for (const part of entry.path.split('/')) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error('Package symbolic links are not accepted.');
    }
    if (!(await fs.stat(cursor)).isFile() || (await digest(cursor)) !== entry.sha256)
      throw new Error(`Package checksum failed: ${entry.path}`);
  }
  if (required.size) throw new Error('The package manifest is incomplete.');
  if (exact) {
    const allowed = new Set([...packageFiles, 'manifest.json', 'runtime', 'connectors']);
    async function inspect(directory, prefix = '') {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const name = prefix + item.name;
        if (!allowed.has(name) || item.isSymbolicLink())
          throw new Error(
            'The installation contains extra files. Preserve them and install to a different destination.',
          );
        if (item.isDirectory()) await inspect(path.join(directory, item.name), name + '/');
      }
    }
    await inspect(root);
  }
  return manifest;
}
async function verifyRuntime(root, manifest) {
  const { stdout } = await exec(
    path.join(root, 'runtime', runtimeName),
    ['-p', 'JSON.stringify([process.versions.node,process.platform,process.arch])'],
    { timeout: 15000, windowsHide: true, maxBuffer: 4096 },
  );
  if (stdout.trim() !== JSON.stringify([manifest.nodeVersion, manifest.platform, manifest.arch]))
    throw new Error('The copied runtime did not pass verification.');
}
async function ensureStopped() {
  const directory = destination + '.running';
  if (!(await exists(directory))) return;
  if ((await fs.lstat(directory)).isSymbolicLink())
    throw new Error('Invalid connector process registry.');
  for (const file of await fs.readdir(directory)) {
    if (!/^\d+\.json$/.test(file))
      throw new Error('Unrecognized connector process registry entry.');
    const pid = Number(file.slice(0, -5));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('Invalid connector process registry entry.');
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') continue;
      throw new Error('Cannot verify that every connector has stopped.');
    }
    throw new Error(
      'A connector is still running. Stop its terminal before updating or rolling back.',
    );
  }
}
async function install() {
  if (inside(source, destination) || inside(destination, source))
    throw new Error('Choose an installation folder separate from the extracted package.');
  const manifest = await verifyPackage(source, true);
  if (mode === 'install' && (await exists(destination)))
    throw new Error(
      'An installation already exists. Use --update --confirm-stopped, or choose a separate destination.',
    );
  if (mode !== 'install' && !(await exists(destination)))
    throw new Error(
      'The installation is missing. Preserve any .previous backup and follow interrupted-update recovery in the setup guide.',
    );
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const realParent = await fs.realpath(parent);
  if (inside(await fs.realpath(source), realParent))
    throw new Error('The installation cannot be inside the extracted package.');
  const lock = path.join(parent, `.${path.basename(destination)}.install-lock`);
  await fs.mkdir(lock);
  let staging;
  try {
    if (mode === 'install' && (await exists(destination)))
      throw new Error('An installation already exists. Preserve it before installing.');
    if (mode !== 'install') {
      await ensureStopped();
      await verifyPackage(destination, false, true);
    }
    if (mode === 'rollback') {
      const prior = await verifyPackage(previous, false, true);
      await verifyRuntime(previous, prior);
      const retained = destination + '.rollback-retained-' + randomUUID();
      await fs.rename(destination, retained);
      try {
        await fs.rename(previous, destination);
      } catch (error) {
        await fs.rename(retained, destination);
        throw error;
      }
      process.stdout.write(
        `Rolled back to ${prior.version} at ${destination}\nThe replaced installation is retained at ${retained}\nExternal project files, credentials, session files and operation journals were not changed.\n`,
      );
      return;
    }
    if (mode === 'update' && (await exists(previous)))
      throw new Error(
        'A .previous rollback copy already exists. Keep it in another folder before another update.',
      );
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
    await verifyRuntime(staging, manifest);
    if (mode === 'update') {
      await fs.rename(destination, previous);
      try {
        await fs.rename(staging, destination);
      } catch (error) {
        await fs.rename(previous, destination);
        throw error;
      }
    } else {
      if (await exists(destination))
        throw new Error('The destination appeared during installation. It has been preserved.');
      await fs.rename(staging, destination);
    }
    staging = undefined;
    process.stdout.write(
      `${mode === 'update' ? 'Updated' : 'Installed'} ${manifest.version} at ${destination}\n${mode === 'update' ? `Previous installation retained at ${previous}\n` : ''}No login item, service, or network listener was started.\nRun ${process.platform === 'win32' ? '.\\agile-connectors.cmd' : './agile-connectors'} doctor in that folder.\nSetup: https://agile-project-ui.enzovalley9.workers.dev/help/connector-setup/\n`,
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
