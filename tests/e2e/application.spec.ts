import { test, expect } from './filesystem';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

test('opens an actual fixture tree in read mode without modifying files', async ({
  page,
  project,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('Browser runtime:', e.message);
  });
  const before = await readFile(join(project, 'docs/notes/meeting.md'), 'utf8');
  await page.goto('/');
  await expect(page).toHaveTitle('Agile Project UI');
  await expect(page.getByRole('banner')).toContainText('Agile Project UI');
  await expect(page.getByRole('main')).toContainText('Compatible with BMAD Method.');
  await expect(page.getByRole('main')).toContainText('not affiliated with or endorsed by BMAD');
  await expect(page.getByRole('button', { name: 'Choose project folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await expect(page.getByRole('button', { name: 'Stories', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stories', exact: true })).toBeVisible();
  expect(await readFile(join(project, 'docs/notes/meeting.md'), 'utf8')).toBe(before);
  expect((await readdir(project)).includes('.bmad-project-ui')).toBe(false);
  expect(errors).toEqual([]);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
});

async function openNote(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
}
async function replaceSource(page: import('@playwright/test').Page, text: string) {
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.getByLabel('Markdown source');
  await source.click();
  await source.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

test('edits the source, reviews it, writes original file bytes and reopens the saved content', async ({
  page,
  project,
}) => {
  await openNote(page);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  const path = join(project, 'docs/notes/meeting.md');
  const before = await readFile(path, 'utf8');
  const after = before + '\nE2E test: watering confirmed in the browser.\n';
  await replaceSource(page, after);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('E2E test: watering confirmed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved locally and verified.')).toBeVisible();
  expect(await readFile(path, 'utf8')).toBe(after);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Visual view', exact: true }).click();
  await expect(
    page.getByText('E2E test: watering confirmed in the browser.', { exact: true }),
  ).toBeVisible();
});

test('keeps a stale draft and blocks overwriting an external edit', async ({ page, project }) => {
  await openNote(page);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  const path = join(project, 'docs/notes/meeting.md');
  const before = await readFile(path, 'utf8');
  await replaceSource(page, before + '\nMy unsaved draft.\n');
  await writeFile(path, before + '\nExternal IDE change.\n');
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await expect(page.getByText('The file changed outside this view.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('My unsaved draft.');
  await expect(dialog).toContainText('External IDE change.');
  expect(await readFile(path, 'utf8')).toContain('External IDE change.');
  expect(await readFile(path, 'utf8')).not.toContain('My draft');
});

test('persists a line thread, reply, reaction, message history and resolution in sidecars', async ({
  page,
  project,
}) => {
  await openNote(page);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('E2E team');
  await page.getByRole('button', { name: 'Use this name' }).click();
  await page.getByText('Comment on a passage', { exact: true }).click();
  await page.getByLabel('Start line').fill('5');
  await page.getByLabel('End line').fill('5');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('New comment', { exact: true }).fill('Review this time slot 💧');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.getByText('Review this time slot 💧', { exact: true })).toBeVisible();
  await page.getByLabel('Reply', { exact: true }).fill('Reviewed in the test.');
  await page.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByText('Reviewed in the test.', { exact: true })).toBeVisible();
  const first = page.getByRole('region', { name: 'Message from E2E team' }).first();
  await first.getByRole('button', { name: '👍: 0 reactions' }).click();
  await expect(first.getByRole('button', { name: '👍: 1 reactions' })).toBeVisible();
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit your reply').fill('Corrected comment.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(first.getByText('edited', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  const folder = join(project, '.bmad-project-ui/comments/threads');
  const names = await readdir(folder);
  expect(names).toHaveLength(1);
  const thread = JSON.parse(await readFile(join(folder, names[0]), 'utf8'));
  expect(thread.anchor.quote).toBe('The plot tended by Zoë receives water 💧.');
  expect(thread.messages).toHaveLength(2);
  expect(thread.messages[0].revisions[0].text).toBe('Review this time slot 💧');
  expect(thread.messages[0].reactions).toHaveLength(1);
  expect(thread.status).toBe('resolved');
  await page.reload();
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(page.getByText('Corrected comment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeDisabled();
});

test('does not execute source HTML or request remote document images', async ({
  page,
  project,
}) => {
  void project;
  const external: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://example.com/')) external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'security-preview.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adversarial test content' })).toBeVisible();
  expect(await page.evaluate(() => '__unsafeExecuted' in window)).toBe(false);
  expect(external).toEqual([]);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});
