import { test, expect } from './filesystem';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('reviews and exports private copies before restoring an interrupted multi-file save', async ({
  page,
  project,
}) => {
  const paths = ['docs/notes/meeting.md', 'docs/manual/watering.md'];
  const copies = await Promise.all(
    paths.map(async (path) => {
      const before = await readFile(join(project, path), 'utf8');
      return { path, before, after: before + '\nContent from an interrupted save.\n' };
    }),
  );
  const id = randomUUID();
  const journal = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    entries: copies.map((copy) => ({
      path: copy.path,
      before: hash(copy.before),
      after: hash(copy.after),
    })),
  };
  await writeFile(join(project, paths[0]), copies[0].after);
  await mkdir(join(project, '.bmad-project-ui/local'), { recursive: true });
  await writeFile(
    join(project, '.bmad-project-ui/local/write-recovery.json'),
    JSON.stringify(journal),
  );
  await page.goto('/');
  await page.evaluate(
    async ({ id, copies }) => {
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('bmad-project-ui-recovery', { create: true });
      const file = await directory.getFileHandle(id + '.json', { create: true }),
        stream = await file.createWritable();
      await stream.write(JSON.stringify({ schemaVersion: 1, id, copies }));
      await stream.close();
    },
    { id, copies },
  );
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await expect(page.getByText('A save needs verification.')).toBeVisible();
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Review recovery' }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted save' });
  await expect(review.getByText('Planned content saved', { exact: true })).toBeVisible();
  await expect(review.getByText('Original content preserved', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Export copies' })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Export copies' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.copies).toEqual(copies);
  await review.getByRole('button', { name: 'Restore originals' }).click();
  await page
    .getByRole('dialog', { name: 'Restore originals' })
    .getByRole('button', { name: 'Confirm restoration' })
    .click();
  await expect(
    page.getByText('File state verified. You can continue your pending changes.'),
  ).toBeVisible();
  for (const copy of copies)
    expect(await readFile(join(project, copy.path), 'utf8')).toBe(copy.before);
  await expect(page.getByText('A save needs verification.')).toHaveCount(0);
  await expect(
    readFile(join(project, '.bmad-project-ui/local/write-recovery.json')),
  ).rejects.toHaveProperty('code', 'ENOENT');
});

test('shows the limits of hash-only recovery without claiming unavailable backups', async ({
  page,
  project,
}) => {
  const path = 'docs/notes/meeting.md',
    before = await readFile(join(project, path), 'utf8');
  await mkdir(join(project, '.bmad-project-ui/local'), { recursive: true });
  await writeFile(
    join(project, '.bmad-project-ui/local/write-recovery.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      entries: [{ path, before: hash(before), after: hash(before + '\nPlanned.') }],
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('button', { name: 'Review recovery' }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted save' });
  await expect(review.getByText(/This browser has no verifiable copies/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Restore originals' })).toHaveCount(0);
  await expect(review.getByRole('button', { name: 'Accept verified state' })).toBeDisabled();
  expect(await readFile(join(project, path), 'utf8')).toBe(before);
});

test('preserves an external recovery version and requires exporting copies before clearing the journal', async ({
  page,
  project,
}) => {
  const path = 'docs/notes/meeting.md',
    before = await readFile(join(project, path), 'utf8'),
    after = before + '\nInterrupted save.\n',
    external = before + '\nExternal change that must be preserved.\n',
    id = randomUUID(),
    copies = [{ path, before, after }];
  await writeFile(join(project, path), external);
  await mkdir(join(project, '.bmad-project-ui/local'), { recursive: true });
  await writeFile(
    join(project, '.bmad-project-ui/local/write-recovery.json'),
    JSON.stringify({
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      entries: [{ path, before: hash(before), after: hash(after) }],
    }),
  );
  await page.goto('/');
  await page.evaluate(
    async ({ id, copies }) => {
      const directory = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('bmad-project-ui-recovery', { create: true }),
        file = await directory.getFileHandle(id + '.json', { create: true }),
        stream = await file.createWritable();
      await stream.write(JSON.stringify({ schemaVersion: 1, id, copies }));
      await stream.close();
    },
    { id, copies },
  );
  await page.getByRole('button', { name: 'Choose project folder' }).click();
  await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Review recovery' }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted save' });
  await expect(review.getByText(/Restoration is blocked to preserve it/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Restore originals' })).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Complete planned save' })).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Keep current files' })).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Export copies' }).click();
  const download = await downloadPromise,
    exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.copies).toEqual(copies);
  expect(exported.current[path]).toBe(external);
  expect(await readFile(join(project, path), 'utf8')).toBe(external);
  await review.getByRole('button', { name: 'Keep current files' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Keep the current files' });
  await expect(
    confirmation.getByText(/The current external version will be preserved/),
  ).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm and keep current state' }).click();
  await expect(page.getByText('A save needs verification.')).toHaveCount(0);
  expect(await readFile(join(project, path), 'utf8')).toBe(external);
  await expect(
    readFile(join(project, '.bmad-project-ui/local/write-recovery.json')),
  ).rejects.toHaveProperty('code', 'ENOENT');
});
