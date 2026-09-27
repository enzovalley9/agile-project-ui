import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('demo provides work context without folder permissions or write controls', async ({
  page,
}, info) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Public beta', { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Connect to Git/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await expect(page.getByText('View plots', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sprint', exact: true }).click();
  await expect(page.getByText('Book slot', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Epics', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Coordinate watering/ })).toBeVisible();
  expect(failures).toEqual([]);
  await page.screenshot({ path: info.outputPath('beta-demo.png'), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('folder snapshot is readable and original bytes cannot be changed', async ({ page }, info) => {
  test.skip(
    info.project.name === 'mobile-webkit',
    'Physical mobile folder pickers depend on the operating system; demo is the supported baseline.',
  );
  const root = await mkdtemp(join(tmpdir(), 'agile-reading-'));
  try {
    await mkdir(join(root, 'docs'));
    await writeFile(
      join(root, 'docs', 'welcome.md'),
      '# Imported document\n\nOnly in this browser.\n',
    );
    await writeFile(join(root, '.env'), 'SKIP_THIS_FILE=yes');
    await writeFile(join(root, 'excluded.png'), 'unsupported');
    await page.goto('/');
    await page.getByLabel('Import read-only project folder').setInputFiles(root);
    await expect(
      page.getByRole('heading', { name: 'Imported document', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByText('Only in this browser.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Read-only snapshot.' })).toContainText(
      'unsupported or excluded',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('public help shows real screenshots and the downloadable licensed example', async ({
  page,
  request,
}) => {
  await page.goto('/help/');
  const screenshot = page.getByRole('img', { name: /Story board in dark mode/ });
  await screenshot.scrollIntoViewIfNeeded();
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(1000);
  const example = await request.get('/example/community-garden.zip');
  expect(example.ok()).toBeTruthy();
  expect((await example.body()).subarray(0, 4).toString('hex')).toBe('504b0304');
  for (const route of [
    'first-use',
    'compatibility',
    'privacy',
    'roadmap',
    'docker',
    'supply-chain',
  ]) {
    const response = await request.get(`/help/${route}/`);
    expect(response.ok(), route).toBeTruthy();
    expect(await response.text()).toContain('<main');
  }
});
