import { test, expect, queueDiskPickerSelections } from './filesystem';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('the tree keeps documentation and configured folders without surrounding project files', async ({
  page,
  project,
}, info) => {
  const files = {
    'src/noise.json': '{}',
    'src/prd.md': '# Source-only PRD',
    'package.json': '{}',
    'README.md': '# Repository overview',
    'documentation/setup.md': '# Setup guide',
    'knowledge/context.md': '# Project context',
    'extra/decision.md': '# Extra decision',
    '_bmad/config.user.toml': '[modules.bmm]\nproject_knowledge="knowledge"\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(project, path, '..'), { recursive: true });
    await writeFile(join(project, path), text);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  const tree = page.getByRole('navigation', { name: 'Project files' });
  await expect(tree.getByTitle('docs/notes/meeting.md', { exact: true })).toBeVisible();
  await expect(
    tree.getByTitle('_bmad-output/planning-artifacts/epics.md', { exact: true }),
  ).toBeVisible();
  await expect(tree.getByTitle('documentation/setup.md', { exact: true })).toBeVisible();
  await expect(tree.getByTitle('knowledge/context.md', { exact: true })).toBeVisible();
  for (const path of [
    'src/noise.json',
    'src/prd.md',
    'package.json',
    'README.md',
    'extra/decision.md',
  ])
    await expect(tree.getByTitle(path, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Source-only PRD' })).toHaveCount(0);
  await tree.getByTitle('documentation/setup.md', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Setup guide' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('documentation-tree.png'), fullPage: true });
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await queueDiskPickerSelections(page, [{ id: 'bmad-documentation', path: 'extra' }]);
  await page.getByRole('button', { name: 'Add documentation folder' }).click();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await tree.getByTitle('extra/decision.md', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Extra decision' })).toBeVisible();
  await expect(tree.getByTitle('package.json', { exact: true })).toHaveCount(0);
});
