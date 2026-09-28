import { test, expect } from '../e2e/filesystem';
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('hosted parent selection renders configured child diagrams and saves to the child', async ({
  page,
  project,
}, info) => {
  const child = join(project, 'projects/garden');
  await mkdir(child, { recursive: true });
  for (const name of ['docs', '_bmad-output', '.git'])
    await rename(join(project, name), join(child, name));
  await writeFile(
    join(project, '_bmad/config.toml'),
    '[core]\noutput_folder = "{project-root}/projects/garden/_bmad-output"\n[modules.bmm]\nproject_knowledge = "{project-root}/projects/garden/docs"\n',
  );
  await writeFile(
    join(project, '_bmad/bmm/config.yaml'),
    'output_folder: "{project-root}/projects/garden/_bmad-output"\nproject_knowledge: "{project-root}/projects/garden/docs"\n',
  );
  const file = join(child, 'docs/hosted-diagram.md');
  await writeFile(
    file,
    '# Hosted diagram\n\n```mermaid\nsequenceDiagram\nparticipant L as Landing\nparticipant C as ConfirmRendering\nL->>C: confirm-rendered\nC-->>L: completed\n```\n',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const target = window as unknown as { __diagramCsp: string[] };
    target.__diagramCsp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      target.__diagramCsp.push(event.violatedDirective),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'hosted-diagram.md', exact: true }).click();
  await expect(page.locator('figure svg')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await expect(page.locator('figure')).toContainText('confirm-rendered');
  await page.screenshot({ path: info.outputPath('hosted-mermaid.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.getByLabel('Markdown source');
  await source.click();
  await source.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nSaved from the hosted configured project.\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved locally and verified.')).toBeVisible();
  expect(await readFile(file, 'utf8')).toContain('Saved from the hosted configured project.');
  for (const provider of ['Git', 'Jira', 'Confluence']) {
    await page.getByRole('button', { name: new RegExp(`Connect to ${provider}`) }).click();
    await page.getByRole('button', { name: `Install ${provider} connector`, exact: true }).click();
    const guide = page.getByRole('dialog', { name: `Install and start the ${provider} connector` });
    await expect(guide).toBeVisible();
    await guide.getByRole('button', { name: 'Back to connection', exact: true }).click();
  }
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { __diagramCsp: string[] }).__diagramCsp),
  ).toEqual([]);
});
