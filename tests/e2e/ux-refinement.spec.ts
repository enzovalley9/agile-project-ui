import { test, expect } from './filesystem';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

async function open(page: Page, view = 'Stories') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: view, exact: true }).click();
}
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('story drag is disabled in read mode and reviews both coupled source files before a verified move', async ({
  page,
  project,
}) => {
  const storyPath = join(
    project,
    '_bmad-output/implementation-artifacts/1-1-consultar-parcelas.md',
  );
  const sprintPath = join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml');
  const beforeStory = await readFile(storyPath, 'utf8'),
    beforeSprint = await readFile(sprintPath, 'utf8');
  await open(page);
  const card = column(page, 'Done').locator('article').filter({ hasText: 'Consultar parcelas' });
  await expect(card).toHaveAttribute('draggable', 'false');
  await expect(
    page.getByRole('button', { name: 'Move Consultar parcelas', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('switch', { name: 'Edit mode' }).click();
  await expect(card).toHaveAttribute('draggable', 'true');
  await card.dragTo(column(page, 'In progress'));
  const dialog = page.getByRole('dialog', { name: 'Move story' });
  await expect(dialog).toContainText('1-1-consultar-parcelas.md');
  await expect(dialog).toContainText('sprint-status.yaml');
  expect(await readFile(storyPath, 'utf8')).toBe(beforeStory);
  expect(await readFile(sprintPath, 'utf8')).toBe(beforeSprint);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeVisible();
  await card.dragTo(column(page, 'In progress'));
  await dialog.getByRole('button', { name: 'Confirm move' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    column(page, 'In progress').locator('article').filter({ hasText: 'Consultar parcelas' }),
  ).toBeVisible();
  expect(await readFile(storyPath, 'utf8')).toBe(
    beforeStory.replace('Status: done', 'Status: in-progress'),
  );
  expect(await readFile(sprintPath, 'utf8')).toBe(
    beforeSprint.replace('1-1-consultar-parcelas: done', '1-1-consultar-parcelas: in-progress'),
  );
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await expect(
    column(page, 'In progress').locator('article').filter({ hasText: 'Consultar parcelas' }),
  ).toBeVisible();
});

test('sprint drag changes tracking without rewriting execution and shows every related checklist', async ({
  page,
  project,
}) => {
  const sprintPath = join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml');
  const buildPath = join(
    project,
    '_bmad-output/implementation-artifacts/spec-1-3-cancelar-turno.md',
  );
  const beforeSprint = await readFile(sprintPath, 'utf8'),
    beforeBuild = await readFile(buildPath, 'utf8');
  await open(page, 'Sprint');
  const list = page.getByRole('region', { name: 'Sprint stories and tasks' });
  await expect(list.getByText('Crear listado', { exact: true })).toBeVisible();
  await expect(list.getByText('Mostrar zona', { exact: true })).toBeVisible();
  await expect(list.getByText('Validar navegación por teclado', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Edit mode' }).click();
  await column(page, 'Ready')
    .locator('article')
    .filter({ hasText: 'Cancelar turno' })
    .dragTo(column(page, 'In progress'));
  const dialog = page.getByRole('dialog', { name: 'Move story' });
  await expect(dialog).not.toContainText('spec-1-3-cancelar-turno.md');
  await dialog.getByRole('button', { name: 'Confirm move' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await readFile(sprintPath, 'utf8')).toBe(
    beforeSprint.replace('1-3-cancelar-turno: ready-for-dev', '1-3-cancelar-turno: in-progress'),
  );
  expect(await readFile(buildPath, 'utf8')).toBe(beforeBuild);
  await expect(
    column(page, 'In progress').locator('article').filter({ hasText: 'Cancelar turno' }),
  ).toBeVisible();
});

test('epic details expand related stories and completion markers, and open a child with its own editing state', async ({
  page,
  project,
}) => {
  void project;
  await open(page, 'Epics');
  await page.getByRole('button', { name: 'Open epic', exact: true }).first().click();
  const list = page.getByRole('region', { name: 'Stories and tasks' });
  await expect(list.locator('details')).toHaveCount(3);
  const story = list.locator('details').filter({ hasText: 'Consultar parcelas' });
  await expect(story.getByLabel('Complete', { exact: true })).toHaveCount(2);
  await expect(story.getByLabel('Incomplete', { exact: true })).toHaveCount(1);
  await story.locator('summary').click();
  await expect(story.getByText('Crear listado', { exact: true })).toBeHidden();
  await story.locator('summary').click();
  await story.getByRole('button', { name: 'Open story', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Consultar parcelas', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(3);
});

test('keyboard move retains review and rejects an external change without overwriting it', async ({
  page,
  project,
}) => {
  const path = join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml');
  await open(page);
  await page.getByRole('switch', { name: 'Edit mode' }).click();
  const move = page.getByRole('button', { name: 'Move Cancelar turno', exact: true });
  await move.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Move story' });
  await dialog.getByRole('combobox', { name: 'Destination state' }).selectOption('in-progress');
  const external = (await readFile(path, 'utf8')) + '\n# External editor must win.\n';
  await writeFile(path, external);
  await dialog.getByRole('button', { name: 'Confirm move' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await readFile(path, 'utf8')).toBe(external);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('theme follows the system, persists an explicit choice, and keeps both themes accessible', async ({
  page,
  project,
}, info) => {
  void project;
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(theme).toHaveValue('system');
  await theme.selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(theme).toHaveValue('light');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  for (const choice of ['light', 'dark']) {
    await theme.selectOption(choice);
    await expect(page.locator('html')).toHaveAttribute('data-theme', choice);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`stories-${choice}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const edit = page.getByRole('switch', { name: 'Edit mode' });
  await expect(edit).not.toBeChecked();
  await edit.focus();
  await page.keyboard.press('Space');
  await expect(edit).toBeChecked();
  await edit.press('Space');
  await expect(edit).not.toBeChecked();
  await theme.selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('hidden epic drafts survive child navigation and field switching until explicitly discarded', async ({
  page,
  project,
}) => {
  const path = join(project, '_bmad-output/planning-artifacts/epics.md');
  const original = await readFile(path, 'utf8');
  await open(page, 'Epics');
  await page.getByRole('switch', { name: 'Edit mode' }).click();
  await page.getByRole('button', { name: 'Open epic', exact: true }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.getByRole('button', { name: 'Edit fields', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'New value' }).fill('A retained epic draft');
  await dialog.getByRole('button', { name: 'Edit fields', exact: true }).click();
  const beforeUnload = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const browserWarning = await beforeUnload;
  expect(browserWarning.type()).toBe('beforeunload');
  await browserWarning.dismiss();
  expect(page.isClosed()).toBe(false);
  await dialog.getByRole('button', { name: 'Open story', exact: true }).first().click();
  const warning = page.getByRole('dialog', { name: 'Unsaved edit', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Stay here', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit fields', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'New value' })).toHaveValue(
    'A retained epic draft',
  );
  await dialog.getByRole('combobox', { name: 'Field', exact: true }).selectOption('status');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Stay here', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Field', exact: true })).toHaveValue(
    'description',
  );
  await expect(dialog.getByRole('textbox', { name: 'New value' })).toHaveValue(
    'A retained epic draft',
  );
  await dialog.getByRole('combobox', { name: 'Field', exact: true }).selectOption('status');
  await warning.getByRole('button', { name: 'Discard edit and continue', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Field', exact: true })).toHaveValue('status');
  await expect(dialog.getByRole('combobox', { name: 'New value' })).not.toHaveValue(
    'A retained epic draft',
  );
  expect(await readFile(path, 'utf8')).toBe(original);
});

test('backlog tasks declared in the epic remain visible and edit their original checklist without a story file', async ({
  page,
  project,
}) => {
  const epicPath = join(project, '_bmad-output/planning-artifacts/epics.md');
  const sprintPath = join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml');
  const beforeSprint = await readFile(sprintPath, 'utf8');
  const epic = (await readFile(epicPath, 'utf8')).replace(
    'Cerrar un préstamo preservando su historial.',
    'Cerrar un préstamo preservando su historial.\n\n- [x] Identify the borrowed tool\n- [ ] Record its return',
  );
  await writeFile(epicPath, epic);
  await open(page, 'Sprint');
  const sprintTasks = page.getByRole('region', { name: 'Sprint stories and tasks' });
  await expect(sprintTasks.getByText('Identify the borrowed tool', { exact: true })).toBeVisible();
  await expect(sprintTasks.getByText('Record its return', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Epics', exact: true }).click();
  await page.getByRole('button', { name: 'Open epic', exact: true }).nth(1).click();
  const tasks = page
    .getByRole('region', { name: 'Stories and tasks' })
    .locator('details')
    .filter({ hasText: 'Devolver herramienta' });
  await expect(tasks.getByLabel('Complete', { exact: true })).toHaveCount(1);
  await expect(tasks.getByLabel('Incomplete', { exact: true })).toHaveCount(1);
  await tasks.getByRole('button', { name: 'Open story', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: 'Record its return' }),
  ).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('switch', { name: 'Edit mode' }).click();
  await page.getByRole('button', { name: 'Sprint', exact: true }).click();
  await page
    .getByRole('region', { name: 'Sprint stories and tasks' })
    .locator('details')
    .filter({ hasText: 'Devolver herramienta' })
    .getByRole('button', { name: 'Open story', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Record its return' }).click();
  await expect(page.getByRole('heading', { name: 'Review changes before saving' })).toBeVisible();
  expect(await readFile(epicPath, 'utf8')).toBe(epic);
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readFile(epicPath, 'utf8')).toBe(
    epic.replace('- [ ] Record its return', '- [x] Record its return'),
  );
  expect(await readFile(sprintPath, 'utf8')).toBe(beforeSprint);
});

test('dark mode keeps epic tasks, sprint lists and the Markdown editor readable', async ({
  page,
  project,
}, info) => {
  void project;
  await open(page, 'Epics');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Open epic', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Stories and tasks' })).toBeVisible();
  for (const screen of ['epic-dark', 'sprint-dark', 'editor-dark']) {
    if (screen === 'sprint-dark') {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      await page.getByRole('button', { name: 'Sprint', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Sprint stories and tasks' })).toBeVisible();
    } else if (screen === 'editor-dark') {
      await page.getByRole('button', { name: 'Documents', exact: true }).click();
      await page.getByRole('button', { name: '1-1-consultar-parcelas.md', exact: true }).click();
      await page.getByRole('button', { name: 'Markdown', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible();
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${screen}.png`), fullPage: true });
  }
});
