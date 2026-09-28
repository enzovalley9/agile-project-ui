import { test, expect } from './filesystem';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('renders Mermaid locally, updates the theme and preserves invalid source', async ({
  page,
  project,
}, info) => {
  await writeFile(
    join(project, 'docs/diagram.md'),
    '# Diagrams\n\n```mermaid\nsequenceDiagram\nparticipant L as Landing\nparticipant C as ConfirmRendering\nL->>C: confirm-rendered\nC-->>L: completed\n```\n\n```mermaid\nflowchart LR\nA[Open] --> B[Save]\n```\n\n```mermaid\nthis is not a diagram\n```\n\n```ts\nconst ordinary = true;\n```\n',
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'diagram.md', exact: true }).click();
  await expect(page.locator('figure[aria-label="Mermaid diagram"] svg')).toHaveCount(2);
  await expect(
    page.getByText('Diagram preview unavailable. The Mermaid source is preserved below.'),
  ).toBeVisible();
  await expect(page.locator('code.language-ts')).toHaveText('const ordinary = true;\n');
  await expect(page.locator('figure').first()).toContainText('confirm-rendered');
  const before = await page.locator('figure svg').first().innerHTML();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await expect.poll(() => page.locator('figure svg').first().innerHTML()).not.toBe(before);
  await page.screenshot({ path: info.outputPath('mermaid-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByLabel('Markdown source')).toContainText('sequenceDiagram');
});

test('diagram directives cannot enable active markup or external resource loading', async ({
  page,
  project,
}) => {
  await writeFile(
    join(project, 'docs/unsafe.md'),
    '# Untrusted diagram\n\n```mermaid\n%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\nA["<img src=https://example.invalid/tracker onerror=alert(1)>"] --> B[End]\nclick B "javascript:alert(1)"\n```\n',
  );
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) requests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'unsafe.md', exact: true }).click();
  await expect(page.locator('figure svg')).toHaveCount(1);
  await expect(
    page.locator('figure img, figure image, figure a, figure foreignObject, figure script'),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
});
