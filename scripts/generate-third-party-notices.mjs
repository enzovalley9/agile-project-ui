import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const check = process.argv.includes('--check');
const lockSource = await readFile('package-lock.json', 'utf8');
const lock = JSON.parse(lockSource);
const lockHash = createHash('sha256').update(lockSource).digest('hex');
const sections = [];
const helperTools = new Set(['node_modules/esbuild', 'node_modules/vite', 'node_modules/rolldown']);
const inventory = [];
const reviewed = new Set(['MIT', 'ISC', 'BSD-3-Clause']);
for (const [directory, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
  a.localeCompare(b, 'en'),
)) {
  if (!directory || (entry.dev && !helperTools.has(directory)) || entry.link) continue;
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (pkg.version !== entry.version)
    throw new Error(`Install the locked version of ${directory} before generating notices.`);
  const license = pkg.license ?? pkg.licenses?.map((item) => item.type).join(' OR ');
  if (!reviewed.has(license))
    throw new Error(
      `Review the redistribution license for ${pkg.name}@${pkg.version}: ${license ?? 'unknown'}`,
    );
  const candidates = (await readdir(directory))
    .filter((name) =>
      /^(?:third[-_]party[-_])?(?:licen[sc]es?|copying|notice|copyright)(?:[.-]|$)/i.test(name),
    )
    .sort();
  const notices = [];
  for (const name of candidates) {
    const path = join(directory, name);
    if ((await stat(path)).isFile()) notices.push({ name, text: await readFile(path, 'utf8') });
  }
  if (!notices.length && pkg.name === 'format' && pkg.version === '0.2.2') {
    const readme = await readFile(join(directory, 'Readme.md'), 'utf8');
    if (
      !readme.includes('Copyright 2010 - 2014 Sami Samhuri') ||
      !readme.includes('http://sjs.mit-license.org')
    )
      throw new Error('The format license declaration changed. Review the notice override.');
    notices.push({
      name: 'LICENSES/format-0.2.2.txt (documented upstream declaration)',
      text: await readFile('LICENSES/format-0.2.2.txt', 'utf8'),
    });
  }
  if (!notices.length)
    throw new Error(`No redistribution notice found for ${pkg.name}@${pkg.version}.`);
  inventory.push(`| ${pkg.name} | ${pkg.version} | ${license} |`);
  sections.push(
    `## ${pkg.name}@${pkg.version}\n\nLicense: ${license}. Locked package: \`${directory}\`.\n\n` +
      notices
        .map((notice) => `### ${notice.name}\n\n~~~~text\n${notice.text.trimEnd()}\n~~~~\n`)
        .join('\n'),
  );
}
const text = `# Third-party notices\n\nGenerated from the locked production dependency tree and build tools that can emit runtime helpers by \`npm run notices\`.\nLockfile SHA-256: \`${lockHash}\`.\nThis inventory is deliberately inclusive: a particular web or connector bundle may use only a subset.\nThese notices cover dependencies, not the first-party Agile Project UI license.\nTop-level license and attribution files from each production package are retained, including mixed notices such as Lucide/Feather.\nThe separately downloaded Node runtime retains its complete upstream LICENSE in \`runtime/LICENSE\` in every connector package.\nThe Vite, esbuild and Rolldown notices are included conservatively for generated runtime helpers. Other development tools are not distributed; their license declarations remain in the lockfile and installed packages.\n\n| Package | Version | License |\n| --- | --- | --- |\n${inventory.join('\n')}\n\n${sections.join('\n')}\n`;
if (check) {
  if ((await readFile('THIRD_PARTY_NOTICES.md', 'utf8')) !== text)
    throw new Error('Third-party notices are stale. Run npm run notices and review the changes.');
  console.log(
    `Verified notices for ${sections.length} locked packages (production dependencies and build-helper tools).`,
  );
} else {
  await writeFile('THIRD_PARTY_NOTICES.md', text);
  console.log(
    `Generated notices for ${sections.length} locked packages (production dependencies and build-helper tools).`,
  );
}
