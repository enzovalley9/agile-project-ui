import { buildRevision } from './build-revision.mjs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_HELP_PAGES } from './build-public-help.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = path.join(projectRoot, 'dist/web');
const maxFileBytes = 25 * 1024 * 1024;
const maxFiles = 20_000;
const rootFiles = new Set([
  'index.html',
  '_headers',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'version.json',
]);
const helpFiles = new Set([
  'help/help.css',
  ...PUBLIC_HELP_PAGES.map(([, output]) => `help/${output}`),
]);
const allowedDirectories = new Set([
  'assets',
  'help',
  ...PUBLIC_HELP_PAGES.map(([, output]) => path.posix.dirname(`help/${output}`)),
]);
const bundledAsset =
  /^assets\/[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?)$/;
const forbiddenDirectory =
  /(?:^|\/)(?:\.[^/]*|node_modules|tests?|fixtures?|connectors?|src|packages|apps|scripts)(?:\/|$)/i;

export async function checkPublicAssets() {
  for (const relative of ['dist', 'dist/web']) {
    const info = await lstat(path.join(projectRoot, relative));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Expected a real build directory: ${relative}`);
  }
  if ((await realpath(outputRoot)) !== path.resolve(outputRoot))
    throw new Error('Public output cannot traverse a symlink.');
  const seen = new Set();
  let totalBytes = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink())
        throw new Error(`Symlink is forbidden in public assets: ${relative}`);
      if (forbiddenDirectory.test(relative))
        throw new Error(`Private or source path is forbidden in public assets: ${relative}`);
      if (info.isDirectory()) {
        if (!allowedDirectories.has(relative))
          throw new Error(`Unexpected public directory: ${relative}`);
        await walk(absolute, relative + '/');
        continue;
      }
      if (!info.isFile()) throw new Error(`Public assets must be regular files: ${relative}`);
      if (!rootFiles.has(relative) && !helpFiles.has(relative) && !bundledAsset.test(relative)) {
        throw new Error(`File is outside the public asset allowlist: ${relative}`);
      }
      if (info.size > maxFileBytes) throw new Error(`Public file exceeds 25 MiB: ${relative}`);
      seen.add(relative);
      totalBytes += info.size;
      if (seen.size > maxFiles)
        throw new Error('Public build exceeds the free-plan 20,000 asset limit.');
      if (relative.startsWith('help/') && relative.endsWith('.html')) {
        const html = await readFile(absolute, 'utf8');
        if (
          /<(?:script|iframe|object|embed|form|style)\b/i.test(html) ||
          /<[^>]+\son[a-z]+\s*=/i.test(html) ||
          /(?:href|src)\s*=\s*["']\s*(?:javascript|data|vbscript):/i.test(html)
        ) {
          throw new Error(`Active content is forbidden in static help: ${relative}`);
        }
      }
    }
  }
  await walk(outputRoot);
  for (const required of [...rootFiles, ...helpFiles]) {
    if (!seen.has(required)) throw new Error(`Required public asset is missing: ${required}`);
  }
  if (![...seen].some((file) => /^assets\/.+\.js$/.test(file)))
    throw new Error('The application JavaScript bundle is missing.');
  const version = JSON.parse(await readFile(path.join(outputRoot, 'version.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const commit = buildRevision(projectRoot);
  if (
    Object.keys(version).sort().join(',') !== 'revision,version' ||
    version.version !== packageJson.version ||
    version.revision !== commit ||
    !/^[a-f\d]{40}$/.test(version.revision)
  ) {
    throw new Error(
      'Public version metadata must contain only the current package version and full Git revision.',
    );
  }
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const [source, copied] = await Promise.all([
      readFile(path.join(projectRoot, notice)),
      readFile(path.join(outputRoot, notice)),
    ]);
    if (!source.equals(copied))
      throw new Error(`Public legal notice differs from the source: ${notice}`);
  }
  console.log(
    `Verified ${seen.size} public files (${totalBytes} bytes): only application assets, maintained help and legal notices.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPublicAssets();
}
