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
  const before = await readFile(join(project, 'docs/notas/reunion.md'), 'utf8');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose project folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await expect(page.getByRole('button', { name: 'Stories', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stories', exact: true })).toBeVisible();
  expect(await readFile(join(project, 'docs/notas/reunion.md'), 'utf8')).toBe(before);
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
  await page.getByRole('button', { name: 'reunion.md', exact: true }).click();
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
  const path = join(project, 'docs/notas/reunion.md');
  const before = await readFile(path, 'utf8');
  const after = before + '\nPrueba E2E: riego confirmado desde el navegador.\n';
  await replaceSource(page, after);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Prueba E2E: riego confirmado');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved locally and verified.')).toBeVisible();
  expect(await readFile(path, 'utf8')).toBe(after);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Visual view', exact: true }).click();
  await expect(
    page.getByText('Prueba E2E: riego confirmado desde el navegador.', { exact: true }),
  ).toBeVisible();
});

test('keeps a stale draft and blocks overwriting an external edit', async ({ page, project }) => {
  await openNote(page);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  const path = join(project, 'docs/notas/reunion.md');
  const before = await readFile(path, 'utf8');
  await replaceSource(page, before + '\nMi borrador sin guardar.\n');
  await writeFile(path, before + '\nCambio externo del IDE.\n');
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await expect(page.getByText('The file changed outside this view.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Mi borrador sin guardar.');
  await expect(dialog).toContainText('Cambio externo del IDE.');
  expect(await readFile(path, 'utf8')).toContain('Cambio externo del IDE.');
  expect(await readFile(path, 'utf8')).not.toContain('Mi borrador');
});

test('persists a line thread, reply, reaction, message history and resolution in sidecars', async ({
  page,
  project,
}) => {
  await openNote(page);
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Equipo E2E');
  await page.getByRole('button', { name: 'Use this name' }).click();
  await page.getByText('Comment on a passage', { exact: true }).click();
  await page.getByLabel('Start line').fill('5');
  await page.getByLabel('End line').fill('5');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('New comment', { exact: true }).fill('Revisar este turno 💧');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.getByText('Revisar este turno 💧', { exact: true })).toBeVisible();
  await page.getByLabel('Reply', { exact: true }).fill('Revisado desde la prueba.');
  await page.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByText('Revisado desde la prueba.', { exact: true })).toBeVisible();
  const first = page.getByRole('region', { name: 'Message from Equipo E2E' }).first();
  await first.getByRole('button', { name: '👍: 0 reactions' }).click();
  await expect(first.getByRole('button', { name: '👍: 1 reactions' })).toBeVisible();
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit your reply').fill('Comentario corregido.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(first.getByText('edited', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  const folder = join(project, '.bmad-project-ui/comments/threads');
  const names = await readdir(folder);
  expect(names).toHaveLength(1);
  const thread = JSON.parse(await readFile(join(folder, names[0]), 'utf8'));
  expect(thread.anchor.quote).toBe('La parcela de Lucía recibe agua 💧.');
  expect(thread.messages).toHaveLength(2);
  expect(thread.messages[0].revisions[0].text).toBe('Revisar este turno 💧');
  expect(thread.messages[0].reactions).toHaveLength(1);
  expect(thread.status).toBe('resolved');
  await page.reload();
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'reunion.md', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(page.getByText('Comentario corregido.', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Contenido adverso de prueba' })).toBeVisible();
  expect(await page.evaluate(() => '__unsafeExecuted' in window)).toBe(false);
  expect(external).toEqual([]);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});
