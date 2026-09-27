import { test, expect } from '../e2e/filesystem';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const exec = promisify(execFile);
const git = async (root: string, ...args: string[]) =>
  (await exec('git', args, { cwd: root })).stdout.trim();

test('published assets expose help and licenses while private files stay unavailable', async ({
  page,
  request,
}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  await expect(page).toHaveTitle('Agile Project UI');
  await expect(page.getByRole('banner')).toContainText('Agile Project UI');
  await expect(page.getByRole('main')).toContainText('Compatible with BMAD Method.');
  await expect(page.getByRole('main')).toContainText('not affiliated with or endorsed by BMAD');
  await expect(page.getByRole('button', { name: 'Choose project folder' })).toBeVisible();
  const license = await request.get('/LICENSE');
  expect(license.ok()).toBeTruthy();
  expect(await license.text()).toContain('MIT License');
  const version = await request.get('/version.json');
  expect(version.ok()).toBeTruthy();
  expect(await version.json()).toEqual({
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    revision: await git(process.cwd(), 'rev-parse', 'HEAD'),
  });
  await page.goto('/help/connector-setup/');
  await expect(page.getByRole('main')).toContainText('Git');
  await expect(page.getByRole('main')).toContainText('Confluence');
  for (const path of ['/.env', '/.git/config', '/AGENTS.md', '/docs/PRD.md', '/connectors/git.mjs'])
    expect((await request.get(path)).status(), path).toBe(404);
});

test('hosted frontend reads and saves real disk files, moves work and commits through the local CLI', async ({
  page,
  project,
  baseURL,
}, info) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript(() => {
    const target = window as unknown as { __cspFailures: string[] };
    target.__cspFailures = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      target.__cspFailures.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  await git(project, 'init', '-b', 'main');
  await git(project, 'config', 'user.name', 'Hosted acceptance');
  await git(project, 'config', 'user.email', 'acceptance@example.invalid');
  await writeFile(join(project, '.gitignore'), '.bmad-project-ui/local/\n');
  await git(project, 'add', '.');
  await git(project, 'commit', '-m', 'Original hosted acceptance fixture');
  const state = await mkdtemp(join(tmpdir(), 'hosted-connector-'));
  const tokenFile = join(state, 'capability');
  const port = 43320;
  const child = spawn(
    process.execPath,
    [
      resolve('dist/connectors/git.mjs'),
      '--repo',
      project,
      '--origin',
      new URL(baseURL!).origin,
      '--port',
      String(port),
      '--token-file',
      tokenFile,
    ],
    { stdio: 'ignore' },
  );
  const closed = once(child, 'exit');
  try {
    await expect
      .poll(async () => {
        if (child.exitCode !== null) throw new Error('Local connector exited before readiness.');
        return fetch(`http://127.0.0.1:${port}/v1/health`)
          .then((r) => r.ok)
          .catch(() => false);
      })
      .toBe(true);
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose project folder' }).click();
    await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
    await page.getByRole('button', { name: /Connect to Git/ }).click();
    await page
      .getByLabel('Local connector address', { exact: true })
      .fill(`http://127.0.0.1:${port}`);
    await page.getByLabel('Load session file', { exact: true }).setInputFiles(tokenFile);
    await page.getByRole('checkbox', { name: /I trust the hooks/ }).check();
    await page.getByRole('button', { name: 'Connect and bind project' }).click();
    await expect(page.getByRole('heading', { name: 'Local changes' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    const before = await readFile(join(project, 'docs/notes/meeting.md'), 'utf8');
    const after = before + '\nVerified from the hosted application.\n';
    const editor = page.getByLabel('Markdown source');
    await editor.click();
    await editor.press('ControlOrMeta+a');
    await page.keyboard.insertText(after);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved locally and verified.')).toBeVisible();
    expect(await readFile(join(project, 'docs/notes/meeting.md'), 'utf8')).toBe(after);
    await page.getByRole('button', { name: /Connect to Git/ }).click();
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page
      .locator('label')
      .filter({ hasText: 'docs/notes/meeting.md' })
      .getByRole('checkbox')
      .check();
    await page.getByLabel('Commit message').fill('Verify hosted save and local commit');
    await page.getByRole('button', { name: 'Review commit' }).click();
    await expect(page.getByRole('dialog')).toContainText('Verified from the hosted application.');
    await page.getByRole('button', { name: 'Confirm local commit' }).click();
    await expect(page.getByText('Verified result', { exact: true })).toBeVisible();
    expect(await git(project, 'show', 'HEAD:docs/notes/meeting.md')).toBe(after.trimEnd());
    expect(await git(project, '--no-optional-locks', 'status', '--porcelain')).toBe('');
    await expect(page.getByRole('switch', { name: 'Edit mode', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Stories', exact: true }).click();
    await page
      .getByRole('region', { name: 'Done', exact: true })
      .locator('article')
      .filter({ hasText: 'View plots' })
      .dragTo(page.getByRole('region', { name: 'In progress', exact: true }));
    await page
      .getByRole('dialog', { name: 'Move story' })
      .getByRole('button', { name: 'Confirm move' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await readFile(
        join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml'),
        'utf8',
      ),
    ).toContain('1-1-view-plots: in-progress');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    await page.screenshot({ path: info.outputPath('hosted-stories-dark.png'), fullPage: true });
    expect(
      await page.evaluate(() => (window as unknown as { __cspFailures: string[] }).__cspFailures),
    ).toEqual([]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Choose project folder' }).click();
    await page.getByRole('button', { name: 'Stories', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'In progress', exact: true })
        .locator('article')
        .filter({ hasText: 'View plots' }),
    ).toBeVisible();
    expect(failures).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { __cspFailures: string[] }).__cspFailures),
    ).toEqual([]);
  } finally {
    child.kill('SIGTERM');
    await closed;
  }
});
