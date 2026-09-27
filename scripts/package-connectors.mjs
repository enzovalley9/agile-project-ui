import { mkdir, readFile, writeFile, copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).map((x) => x.replace(/^--/, '').split('=')));
const platform = args.platform || process.platform,
  arch = args.arch || process.arch;
if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch))
  throw new Error('Unsupported packaging target');
const nodeVersion = (await readFile('.node-version', 'utf8')).trim();
const runtimePlatform = platform === 'win32' ? 'win' : platform;
const nodeBase = `node-v${nodeVersion}-${runtimePlatform}-${arch}`;
const archive = `${nodeBase}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
const origin = `https://nodejs.org/dist/v${nodeVersion}/`;
const checksumResponse = await fetch(origin + 'SHASUMS256.txt');
if (!checksumResponse.ok) throw new Error('Node checksum metadata unavailable');
const checksumLine = (await checksumResponse.text())
  .split('\n')
  .find((l) => l.endsWith('  ' + archive));
if (!checksumLine) throw new Error('Requested Node runtime is not published');
const response = await fetch(origin + archive);
if (!response.ok) throw new Error('Node runtime download failed');
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== checksumLine.split(' ')[0]) throw new Error('Node archive checksum mismatch');
const temp = await mkdtemp(join(tmpdir(), 'bmad-package-'));
await writeFile(join(temp, archive), bytes);
if (platform === 'win32') execFileSync('tar', ['-xf', join(temp, archive), '-C', temp]);
else execFileSync('tar', ['-xzf', join(temp, archive), '-C', temp]);
const name = `bmad-project-ui-connectors-${platform}-${arch}`;
const packageRoot = await mkdtemp(resolve('dist/packages-'));
const out = join(packageRoot, name);
await mkdir(join(out, 'runtime'), { recursive: true });
await mkdir(join(out, 'connectors'), { recursive: true });
const runtimeName = platform === 'win32' ? 'node.exe' : 'node';
await copyFile(
  join(temp, nodeBase, platform === 'win32' ? 'node.exe' : 'bin/node'),
  join(out, 'runtime', runtimeName),
);
if (platform !== 'win32') await chmod(join(out, 'runtime', runtimeName), 0o755);
await copyFile(join(temp, nodeBase, 'LICENSE'), join(out, 'runtime', 'LICENSE'));
for (const connector of ['git', 'atlassian'])
  await copyFile(`dist/connectors/${connector}.mjs`, join(out, 'connectors', `${connector}.mjs`));
await copyFile('THIRD_PARTY_NOTICES.md', join(out, 'THIRD_PARTY_NOTICES.md'));
const firstPartyFiles = [];
try {
  await copyFile('LICENSE', join(out, 'LICENSE'));
  firstPartyFiles.push('LICENSE');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn(
    'First-party LICENSE is pending; this package is not ready for public redistribution.',
  );
}
await writeFile(
  join(out, 'runtime-checksum.json'),
  JSON.stringify({ nodeVersion, archive, sha256: actual, source: origin + archive }, null, 2) +
    '\n',
);
for (const file of ['launch-connectors.mjs', 'install-connectors.mjs'])
  await copyFile(join('scripts', file), join(out, file));
const unixLauncher =
  '#!/bin/sh\nset -eu\nBMAD_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$BMAD_DIR/runtime/node" "$BMAD_DIR/launch-connectors.mjs" "$@"\n';
const windowsLauncher =
  '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0runtime\\node.exe" "%~dp0launch-connectors.mjs" %*\r\nexit /b %errorlevel%\r\n';
await writeFile(
  join(out, platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors'),
  platform === 'win32' ? windowsLauncher : unixLauncher,
);
if (platform !== 'win32') await chmod(join(out, 'bmad-connectors'), 0o755);
const unixInstall =
  '#!/bin/sh\nset -eu\nBMAD_SOURCE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$BMAD_SOURCE/runtime/node" "$BMAD_SOURCE/install-connectors.mjs" "$@"\n';
const windowsInstall =
  '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0runtime\\node.exe" "%~dp0install-connectors.mjs" %*\r\nexit /b %errorlevel%\r\n';
const installer =
  platform === 'win32' ? 'install.cmd' : platform === 'darwin' ? 'install.command' : 'install.sh';
await writeFile(join(out, installer), platform === 'win32' ? windowsInstall : unixInstall);
if (platform !== 'win32') await chmod(join(out, installer), 0o755);
const commandPrefix = platform === 'win32' ? '.\\' : './';
const launcherName = platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors';
await writeFile(
  join(out, 'README.txt'),
  `BMAD Project UI optional connectors\n\nIncludes Node ${nodeVersion} for ${platform}/${arch}. Git must already be installed.\nRun ${commandPrefix}${installer} from the extracted folder, or use that folder directly. The installer also accepts --destination ABSOLUTE_DIRECTORY.\nThe installer verifies package checksums and the copied runtime in a staging folder, then renames it into place. Existing installations are preserved.\nAn interrupted process may leave a hidden staging folder or .connectors.install-lock beside the destination. Ensure no installer is running before removing only these installer leftovers and retrying.\nNo elevated privileges, auto-start, system changes, or listening process on install.\nSetup for Git, Jira and Confluence (requirements, credentials, platform-specific commands and browser steps):\nhttps://github.com/enzovalley9/bmad-project-ui/blob/main/docs/connector-setup.md\nThe web app also provides an Install connector guide with commands for its current origin.\nAfter installation, open a terminal in the printed destination. No command is added to PATH.\nCommand reference: ${commandPrefix}${launcherName} --help\nGit accesses the exact repository supplied with --repo. Jira and Confluence run separately and do not read the repository; the browser reads and saves project files.\nKeep provider credentials outside the project. Load only the generated connector session file in the browser, never the provider credentials JSON.\nStop: Ctrl+C. Uninstall: stop processes and move the installed folder to Trash. Project files are never deleted.\nThird-party terms are included in THIRD_PARTY_NOTICES.md and runtime/LICENSE. First-party redistribution requires the root LICENSE.\nThese packages are unsigned. Checksums detect corruption but do not establish publisher identity. Do not bypass OS security prompts; inspect/run from a trusted developer environment.\n`,
);
const packageFiles = [
  'THIRD_PARTY_NOTICES.md',
  ...firstPartyFiles,
  `runtime/${runtimeName}`,
  'runtime/LICENSE',
  'connectors/git.mjs',
  'connectors/atlassian.mjs',
  'runtime-checksum.json',
  'launch-connectors.mjs',
  'install-connectors.mjs',
  platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors',
  installer,
  'README.txt',
];
const files = [];
for (const file of packageFiles)
  files.push({
    path: file,
    sha256: createHash('sha256')
      .update(await readFile(join(out, file)))
      .digest('hex'),
    mode:
      platform !== 'win32' &&
      [installer, 'bmad-connectors', `runtime/${runtimeName}`].includes(file)
        ? 0o755
        : 0o644,
  });
await writeFile(
  join(out, 'manifest.json'),
  JSON.stringify({ schemaVersion: 1, nodeVersion, platform, arch, files }, null, 2) + '\n',
);
await mkdir('dist/artifacts', { recursive: true });
const output = resolve('dist/artifacts', name + '.tar.gz');
execFileSync('tar', ['-czf', output, '-C', packageRoot, name]);
const packaged = await readFile(output);
await writeFile(
  output + '.sha256',
  createHash('sha256').update(packaged).digest('hex') + '  ' + name + '.tar.gz\n',
);
console.log(
  `Packaged ${name} with verified Node ${nodeVersion}; no system installation performed.`,
);
await rm(temp, { recursive: true, force: true });
await rm(packageRoot, { recursive: true, force: true });
