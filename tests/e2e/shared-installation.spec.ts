import { test, expect, queueDiskPickerSelections } from './filesystem';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { createGitApp } from '../../apps/git-connector/src/app';

const git = promisify(execFile);

async function prepareSharedFixture(project: string) {
  const child = join(project, 'projects/garden');
  const sibling = join(project, 'projects/other');
  await mkdir(child, { recursive: true });
  await mkdir(join(sibling, 'docs'), { recursive: true });
  await mkdir(join(sibling, '.git'));
  await rename(join(project, '_bmad-output'), join(child, '_bmad-output'));
  await rename(join(project, 'docs'), join(child, 'docs'));
  await rename(join(project, '.git'), join(child, '.git'));
  await writeFile(join(sibling, 'docs/sibling-secret.md'), '# Sibling document\n');
  await writeFile(
    join(project, '_bmad/config.toml'),
    `[core]\nproject_name = "Community Garden"\noutput_folder = "projects/garden/_bmad-output"\n\n[modules.bmm]\nplanning_artifacts = "{output_folder}/planning-artifacts"\nimplementation_artifacts = "{output_folder}/implementation-artifacts"\nproject_knowledge = "projects/garden/docs"\n`,
  );
  await writeFile(
    join(project, '_bmad/bmm/config.yaml'),
    'project_name: Community Garden\noutput_folder: projects/garden/_bmad-output\nplanning_artifacts: "{output_folder}/planning-artifacts"\nimplementation_artifacts: "{output_folder}/implementation-artifacts"\nproject_knowledge: projects/garden/docs\n',
  );
  return { child, sibling };
}

test('opens a documentation repository without a local BMAD installation', async ({
  page,
  project,
}) => {
  await rm(join(project, '_bmad'), { recursive: true });
  const note = await readFile(join(project, 'docs/notes/meeting.md'), 'utf8');

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test meeting' })).toBeVisible();
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Book slot/ })).toBeVisible();

  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByText('installation-absent', { exact: true })).toBeVisible();
  await expect(page.getByText(/Available project documents are still indexed/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect shared BMAD installation' }),
  ).toBeVisible();
  expect(await readFile(join(project, 'docs/notes/meeting.md'), 'utf8')).toBe(note);
});

test('uses a parent BMAD installation while keeping documents and edits in the selected child repository', async ({
  page,
  project,
}) => {
  const { child, sibling } = await prepareSharedFixture(project);
  const notePath = join(child, 'docs/notes/meeting.md');
  const before = await readFile(notePath, 'utf8');

  await page.goto('/');
  await queueDiskPickerSelections(page, [
    { id: 'bmad-installation', path: '' },
    { id: 'bmad-project-child', path: 'projects/garden' },
  ]);
  await page.getByRole('button', { name: 'Choose shared BMAD installation' }).click();
  await page.getByRole('button', { name: 'Choose documentation project' }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test meeting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'sibling-secret.md' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Book slot/ })).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByText('installation-absent', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.getByLabel('Markdown source');
  await source.click();
  await source.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nEdited in the selected child repository.\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved locally and verified.')).toBeVisible();
  expect(await readFile(notePath, 'utf8')).toContain('Edited in the selected child repository.');
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Shared fixture');
  await page.getByRole('button', { name: 'Use this name' }).click();
  await page.getByText('Comment on a passage', { exact: true }).click();
  await page.getByLabel('Start line').fill('5');
  await page.getByLabel('End line').fill('5');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('New comment', { exact: true }).fill('Child repository comment');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.getByText('Child repository comment', { exact: true })).toBeVisible();
  await expect
    .poll(() => readdir(join(child, '.bmad-project-ui/comments/threads')).catch(() => []))
    .toHaveLength(1);
  await expect(access(join(project, '.bmad-project-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(sibling, 'docs/sibling-secret.md'), 'utf8')).toBe(
    '# Sibling document\n',
  );
  expect(await readFile(join(project, '_bmad/config.toml'), 'utf8')).toContain(
    'projects/garden/_bmad-output',
  );
  expect(before).not.toContain('Edited in the selected child repository.');
});

test('connects a shared installation after opening its child repository directly', async ({
  page,
  project,
}) => {
  const { child } = await prepareSharedFixture(project);
  const before = await readFile(join(child, 'docs/notes/meeting.md'), 'utf8');
  await page.goto('/');
  await queueDiskPickerSelections(page, [{ id: 'bmad-project', path: 'projects/garden' }]);
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByText('installation-absent', { exact: true })).toBeVisible();

  await queueDiskPickerSelections(page, [{ id: 'bmad-installation', path: '' }]);
  await page.getByRole('button', { name: 'Connect shared BMAD installation' }).click();
  await expect(page.getByText('installation-absent', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test meeting' })).toBeVisible();
  expect(await readFile(join(child, 'docs/notes/meeting.md'), 'utf8')).toBe(before);
});

test('rejects a project outside the selected installation folder', async ({ page, project }) => {
  await prepareSharedFixture(project);
  await mkdir(join(project, 'installation'));
  await rename(join(project, '_bmad'), join(project, 'installation/_bmad'));
  await page.goto('/');
  await queueDiskPickerSelections(page, [
    { id: 'bmad-installation', path: 'installation' },
    { id: 'bmad-project-child', path: 'projects/garden' },
  ]);
  await page.getByRole('button', { name: 'Choose shared BMAD installation' }).click();
  await page.getByRole('button', { name: 'Choose documentation project' }).click();
  await expect(
    page.getByText('Select a project folder inside the chosen BMAD installation folder.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose documentation project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'meeting.md', exact: true })).toHaveCount(0);
});

test('binds Git to the selected child repository, not the shared installation', async ({
  page,
  project,
}) => {
  const { child } = await prepareSharedFixture(project);
  const runGit = async (...args: string[]) =>
    (await git('git', args, { cwd: child })).stdout.trim();
  await runGit('init', '-b', 'main');
  await runGit('config', 'user.name', 'Agile Project UI E2E');
  await runGit('config', 'user.email', 'agile-project-ui-e2e@example.invalid');
  await writeFile(join(child, '.gitignore'), '.bmad-project-ui/local/\n');
  await runGit('add', '.');
  await runGit('commit', '-m', 'Child fixture');

  const state = await mkdtemp(join(tmpdir(), 'agile-shared-git-e2e-'));
  const tokenFile = join(state, 'session');
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const port = 43228;
  const app = createGitApp({
    repo: child,
    origin: 'http://127.0.0.1:5173',
    token,
    port,
    stateDir: join(state, 'journal'),
  });
  await app.service.ready;
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  try {
    await page.goto('/');
    await queueDiskPickerSelections(page, [
      { id: 'bmad-installation', path: '' },
      { id: 'bmad-project-child', path: 'projects/garden' },
    ]);
    await page.getByRole('button', { name: 'Choose shared BMAD installation' }).click();
    await page.getByRole('button', { name: 'Choose documentation project' }).click();
    await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
    await page.getByRole('button', { name: /Connect to Git/ }).click();
    await page
      .getByLabel('Local connector address', { exact: true })
      .fill(`http://127.0.0.1:${port}`);
    await page.getByLabel('Load session file', { exact: true }).setInputFiles(tokenFile);
    await page.getByRole('checkbox', { name: /I trust the hooks/ }).check();
    await page.getByRole('button', { name: 'Connect and bind project' }).click();
    await expect(page.getByRole('heading', { name: 'Local changes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'garden' })).toBeVisible();
    expect(await runGit('rev-parse', '--show-toplevel')).toBe(child);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
  }
});
