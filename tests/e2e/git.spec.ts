import { test, expect } from './filesystem';
import { serve } from '@hono/node-server';
import { createGitApp } from '../../apps/git-connector/src/app';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const exec = promisify(execFile);
const command = async (root: string, ...args: string[]) =>
  (await exec('git', args, { cwd: root })).stdout.trim();
async function setup(root: string, port: number) {
  const state = await mkdtemp(join(tmpdir(), 'agile-git-e2e-')),
    remote = join(state, 'remote.git'),
    tokenFile = join(state, 'session');
  await mkdir(remote);
  await command(remote, 'init', '--bare');
  await command(root, 'init', '-b', 'main');
  await command(root, 'config', 'user.name', 'Agile Project UI E2E');
  await command(root, 'config', 'user.email', 'agile-project-ui-e2e@example.invalid');
  await writeFile(join(root, '.gitignore'), '.bmad-project-ui/local/\n');
  await command(root, 'add', '.');
  await command(root, 'commit', '-m', 'Original fixture');
  await command(root, 'branch', 'review-fixture');
  await command(root, 'remote', 'add', 'origin', remote);
  await command(root, 'push', '-u', 'origin', 'main');
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const app = createGitApp({
    repo: root,
    origin: 'http://127.0.0.1:5173',
    token,
    port,
    stateDir: join(state, 'journal'),
    allowLocalRemotes: true,
  });
  await app.service.ready;
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  return {
    remote,
    tokenFile,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        // Open browser connections can hold server.close open after every assertion
        // passed. This disposable fixture owns its sockets and closes them at teardown.
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}
async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
}
async function connect(page: import('@playwright/test').Page, port: number, tokenFile: string) {
  await page.getByRole('button', { name: /Connect to Git/ }).click();
  await page
    .getByLabel('Local connector address', { exact: true })
    .fill(`http://127.0.0.1:${port}`);
  await page.getByLabel('Load session file', { exact: true }).setInputFiles(tokenFile);
  await page.getByRole('checkbox', { name: /I trust the hooks/ }).check();
  await page.getByRole('button', { name: 'Connect and bind project' }).click();
  await expect(page.getByRole('heading', { name: 'Local changes' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeEnabled();
}
async function edit(page: import('@playwright/test').Page, text: string) {
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const editor = page.getByLabel('Markdown source');
  await editor.click();
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

test('native Git roundtrip from browser: save, exact review, commit, push and existing branch switch', async ({
  page,
  project,
}) => {
  const setupResult = await setup(project, 43220);
  try {
    await open(page);
    await connect(page, 43220, setupResult.tokenFile);
    const before = await readFile(join(project, 'docs/notes/meeting.md'), 'utf8');
    const after = before + '\nReviewed Git E2E change.\n';
    await edit(page, after);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved locally and verified.')).toBeVisible();
    await page.getByRole('button', { name: /Connect to Git/ }).click();
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page
      .locator('label')
      .filter({ hasText: 'docs/notes/meeting.md' })
      .getByRole('checkbox')
      .check();
    await page.getByLabel('Commit message').fill('Verify original fixture update');
    await page.getByRole('button', { name: 'Review commit' }).click();
    await expect(page.getByRole('dialog')).toContainText('Reviewed Git E2E change.');
    await page.getByRole('button', { name: 'Confirm local commit' }).click();
    await expect(page.getByText('Verified result', { exact: true })).toBeVisible();
    const localHead = await command(project, 'rev-parse', 'HEAD');
    expect(await command(project, 'show', 'HEAD:docs/notes/meeting.md')).toContain(
      'Reviewed Git E2E change.',
    );
    // This assertion can overlap the UI's post-commit repository refresh. Avoid
    // optional index writes so the observer does not introduce an external lock.
    expect(await command(project, '--no-optional-locks', 'status', '--porcelain')).toBe('');
    await page.getByRole('button', { name: 'Review push', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Verify original fixture update');
    await expect(page.getByRole('dialog')).toContainText('Reviewed Git E2E change.');
    await page.getByRole('button', { name: 'Confirm push to remote' }).click();
    await expect(page.getByText('Remote revision ' + localHead, { exact: true })).toBeVisible();
    expect(await command(setupResult.remote, 'rev-parse', 'refs/heads/main')).toBe(localHead);
    await page
      .getByRole('combobox', { name: 'Branch', exact: true })
      .selectOption('review-fixture');
    await page.getByRole('button', { name: 'Review branch change' }).click();
    await page.getByRole('button', { name: 'Confirm branch change' }).click();
    await expect(page.getByText(/Branch review-fixture ·/)).toBeVisible();
    expect(await command(project, 'branch', '--show-current')).toBe('review-fixture');
    expect(await readFile(join(project, 'docs/notes/meeting.md'), 'utf8')).toBe(before);
  } finally {
    await setupResult.close();
  }
});

test('external branch switch with identical document bytes cannot receive the old draft', async ({
  page,
  project,
}) => {
  const setupResult = await setup(project, 43221);
  try {
    await open(page);
    await connect(page, 43221, setupResult.tokenFile);
    const path = join(project, 'docs/notes/meeting.md'),
      before = await readFile(path, 'utf8');
    await edit(page, before + '\nDraft from main.\n');
    await command(project, 'switch', 'review-fixture');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/The branch or commit changed outside/)).toBeVisible();
    expect(await readFile(path, 'utf8')).toBe(before);
    await expect(page.getByLabel('Markdown source')).toContainText('Draft from main.');
  } finally {
    await setupResult.close();
  }
});

test('opens a preexisting merge safely and resumes editing only after external resolution and rebinding', async ({
  page,
  project,
}) => {
  const instance = await setup(project, 43222),
    conflictPath = join(project, 'docs/manual/watering.md'),
    notePath = join(project, 'docs/notes/meeting.md');
  try {
    await command(project, 'switch', 'review-fixture');
    await writeFile(conflictPath, '# Watering\n\nBranch version.\n');
    await command(project, 'add', 'docs/manual/watering.md');
    await command(project, 'commit', '-m', 'Review branch watering');
    await command(project, 'switch', 'main');
    await writeFile(conflictPath, '# Watering\n\nMain version.\n');
    await command(project, 'add', 'docs/manual/watering.md');
    await command(project, 'commit', '-m', 'Main watering');
    await expect(command(project, 'merge', 'review-fixture')).rejects.toMatchObject({ code: 1 });
    const conflict = await readFile(conflictPath, 'utf8'),
      before = await readFile(notePath, 'utf8'),
      unmerged = await command(project, 'ls-files', '-u');
    expect(conflict).toContain('<<<<<<< HEAD');
    expect(unmerged).not.toBe('');
    await open(page);
    await page.getByRole('button', { name: 'watering.md', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'conflict markers' })).toBeVisible();
    await expect(page.getByLabel('Markdown source')).toContainText('<<<<<<< HEAD');
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await connect(page, 43222, instance.tokenFile);
    await expect(page.getByRole('alert').filter({ hasText: 'Conflicts found' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'MERGE_HEAD' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review push', exact: true })).toBeDisabled();
    await edit(page, before + '\nDraft preserved during the merge.\n');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByText('Resolve the Git operation or conflicts before saving.', { exact: true }),
    ).toBeVisible();
    expect(await readFile(notePath, 'utf8')).toBe(before);
    expect(await readFile(conflictPath, 'utf8')).toBe(conflict);
    expect(await command(project, 'ls-files', '-u')).toBe(unmerged);
    await expect(page.getByLabel('Markdown source')).toContainText(
      'Draft preserved during the merge.',
    );
    // The error is shown before the post-rejection disk refresh finishes. Wait
    // for the same enabled control a user observes before leaving this context.
    await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeEnabled();
    await writeFile(conflictPath, '# Watering\n\nReviewed external resolution.\n');
    await command(project, 'add', 'docs/manual/watering.md');
    await command(project, 'commit', '-m', 'Resolve watering externally');
    expect(await command(project, 'ls-files', '-u')).toBe('');
    await page.getByRole('button', { name: /Connect to Git/ }).click();
    await page.getByRole('button', { name: 'Discard drafts and continue' }).click();
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Conflicts found' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await connect(page, 43222, instance.tokenFile);
    await page.getByRole('button', { name: 'Refresh files' }).click();
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: 'watering.md', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'conflict markers' })).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Document content' })).toContainText(
      'Reviewed external resolution.',
    );
    const after = before + '\nSaved after resolving and binding.\n';
    await edit(page, after);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved locally and verified.')).toBeVisible();
    expect(await readFile(notePath, 'utf8')).toBe(after);
  } finally {
    await instance.close();
  }
});
