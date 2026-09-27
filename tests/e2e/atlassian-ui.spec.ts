import { test, expect, installDiskPicker } from './filesystem';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtlassianApp } from '../../apps/atlassian-connector/src/service';
import type { ProviderAdapter } from '../../apps/atlassian-connector/src/adapters';
import { markdownProjection } from '../../packages/integrations/src/index';
import type { RemoteResource } from '../../packages/integrations/src/index';

// Real local HTTP service and comparison pipeline; only the account adapter is
// synthetic. These tests do not claim access to a live Atlassian tenant.
async function mockAtlassian(provider: 'jira' | 'confluence' = 'confluence') {
  const token = `e2e-only-${provider}-launcher-capability-123456789`;
  let writes = 0,
    app: Hono;
  const isJira = provider === 'jira',
    body = isJira
      ? 'Reminder imported from Jira\n\nNo external delivery\n'
      : 'Initial remote content.\n',
    title = isJira ? 'Protected remote reminder' : 'Remote watering page';
  const remote: RemoteResource = {
    provider,
    deployment: 'cloud',
    instance: 'https://bmad-e2e.example.test',
    id: '101',
    ...(isJira ? { key: 'GARDEN-17' } : {}),
    url: isJira
      ? 'https://bmad-e2e.example.test/browse/GARDEN-17'
      : 'https://bmad-e2e.example.test/wiki/pages/101',
    scopeId: '7',
    scopeName: 'Garden',
    title,
    version: '1',
    observedAt: new Date().toISOString(),
    fields: isJira ? { title, description: body, status: 'Open' } : { title, body },
    content: markdownProjection(body),
    representation: 'adf',
    draft: isJira ? 'absent' : 'unknown',
    provenance: { api: 'mock', profile: `mock-${provider}` },
  };
  const adapter: ProviderAdapter = {
    instance: remote.instance,
    capabilities: {
      provider,
      deployment: 'cloud',
      profile: `mock-${provider}-safe-read`,
      read: true,
      search: true,
      compare: true,
      import: true,
      export: true,
      remoteUpdate: false,
      fields: isJira ? ['title', 'description', 'status'] : ['title', 'body'],
      representations: ['adf'],
      concurrency: isJira ? 'none' : 'versioned-with-draft-risk',
      blockedReasons: [
        isJira
          ? 'The mock account does not guarantee an atomic precondition.'
          : 'The mock account does not guarantee preservation of remote drafts.',
      ],
      liveVerified: false,
    },
    identity: async () => ({ id: 'account-e2e', displayName: 'E2E mock account' }),
    scopes: async () => ({
      items: [{ id: '7', name: 'Garden', key: 'GARDEN' }],
      complete: true,
      warnings: [],
    }),
    search: async () => ({
      items: [
        {
          id: remote.id,
          key: remote.key,
          title: remote.title,
          url: remote.url,
          scopeId: remote.scopeId,
          version: remote.version,
        },
      ],
      complete: true,
      warnings: [],
    }),
    read: async () => structuredClone(remote),
    history: async () => ({
      items: [
        {
          id: '1',
          version: '1',
          summary: isJira ? 'Issue created in the fixture' : 'Page created in the fixture',
        },
      ],
      complete: true,
      warnings: [],
    }),
    candidate: (request, item) => ({
      title: request.direction === 'import' ? item.title : request.local.title,
      text: request.direction === 'import' ? item.content.markdown : request.local.text,
      status: request.direction === 'import' ? item.fields.status : request.local.status,
    }),
    apply: async () => {
      writes++;
      throw new Error('The blocked mock adapter must never be called');
    },
  };
  let ready!: (port: number) => void;
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const server = serve(
    { fetch: (request) => app.fetch(request), hostname: '127.0.0.1', port: 0 },
    (info) => ready(info.port),
  );
  const port = await listening;
  app = await createAtlassianApp({
    adapter,
    origin: 'http://127.0.0.1:5173',
    port,
    launcherToken: token,
    journalDirectory: await mkdtemp(join(tmpdir(), 'bmad-atlassian-ui-')),
  });
  return {
    token,
    port,
    remote,
    get writes() {
      return writes;
    },
    update(body: string) {
      remote.version = String(Number(remote.version) + 1);
      remote.fields[isJira ? 'description' : 'body'] = body;
      remote.content = markdownProjection(body);
      remote.observedAt = new Date().toISOString();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}

test('walks six verified steps, links, blocks unsafe publish and imports reviewed fields with stale checks', async ({
  page,
  project,
}, info) => {
  const service = await mockAtlassian();
  try {
    const path = join(project, 'docs/notes/meeting.md');
    const original =
      '---\ntitle: Protected local title\nstatus: draft\ncustom: preserve-me\n---\n# Protected local title\n\nOriginal body.\n';
    await writeFile(path, original);
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose project folder' }).click();
    await page.getByRole('button', { name: 'meeting.md', exact: true }).click();
    await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
    await page.getByRole('button', { name: /Connect to Confluence/ }).click();
    await page.getByRole('button', { name: 'Set up connection', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page
      .getByLabel('Local connector address for Confluence')
      .fill(`http://127.0.0.1:${service.port}`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Load session file for Confluence', { exact: true }).setInputFiles({
      name: 'session.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(service.token),
    });
    await page
      .getByRole('button', { name: 'Authorize connection to Confluence', exact: true })
      .click();
    await expect(page.getByText('E2E mock account', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with authorized connection' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check access and resource' }).click();
    await expect(page.getByText('Complete for the queried scope', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByText('Connected for reading', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Local item', exact: true })
      .selectOption('docs/notes/meeting.md');
    await page.getByRole('button', { name: 'Find candidates' }).click();
    await page.getByRole('button', { name: '101 · Remote watering page' }).click();
    await page.getByRole('button', { name: 'Confirm link' }).click();
    await expect(page.getByText('Link saved. No content was published or imported.')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Title', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Compare fields' }).click();
    await expect(
      page.getByRole('heading', { name: 'No common baseline', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Review publication' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      'The mock account does not guarantee preservation of remote drafts.',
    );
    await expect(dialog.getByRole('button', { name: 'Confirm publication' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Compare again' }).click();
    await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('import');
    await page.getByRole('button', { name: 'Compare fields' }).click();
    await page.getByRole('button', { name: 'Review import' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Local files that will change');
    await expect(dialog).toContainText('custom: preserve-me');
    await expect(dialog.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    service.update('Remote content updated after review.\n');
    await dialog.getByRole('button', { name: 'Confirm import' }).click();
    await expect(
      page.getByText('The remote resource changed after review. Compare again before importing.'),
    ).toBeVisible();
    expect(await readFile(path, 'utf8')).toBe(original);
    await page.getByRole('button', { name: 'Compare fields' }).click();
    await page.getByRole('button', { name: 'Review import' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    for (const width of [1440, 1024, 651, 650, 649, 581, 580, 579, 401, 400, 399, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Confluence review at ${width}px`,
      ).toBe(true);
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `Confluence dialog at ${width}px`,
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: info.outputPath('confluence-reviewed-import.png'),
      fullPage: false,
    });
    await dialog.getByRole('button', { name: 'Confirm import' }).click();
    await expect(
      page.getByText('Import saved locally and verified. Git was not modified.'),
    ).toBeVisible();
    const saved = await readFile(path, 'utf8');
    expect(saved).toContain('custom: preserve-me');
    expect(saved).toContain('status: draft');
    expect(saved).toContain('# Protected local title');
    expect(saved).toContain('Remote content updated after review');
    expect(saved).not.toContain('Original body.');
    expect(service.writes).toBe(0);
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(
      page.getByText('Remote content updated after review.', { exact: true }),
    ).toBeVisible();
    const metadata = await readFile(
      join(project, '.bmad-project-ui/integrations/confluence.json'),
      'utf8',
    );
    expect(metadata).not.toContain(service.token);
    expect(metadata).not.toContain('Remote content');
    expect(JSON.parse(metadata).bindings).toHaveLength(1);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(service.token);
    await page.getByRole('button', { name: /Connect to Confluence/ }).click();
    await page.getByRole('button', { name: /docs\/notes\/meeting.md/ }).click();
    await page.getByRole('checkbox', { name: 'Title', exact: true }).uncheck();
    service.update('Remote change after the verified baseline.\n');
    await page.getByRole('button', { name: 'Compare fields' }).click();
    await expect(page.getByRole('heading', { name: 'Remote changes', exact: true })).toBeVisible();
    await expect(page.getByText(/Private baseline saved in this browser/)).toBeVisible();
    await page.getByRole('button', { name: 'Review import' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    const config = JSON.parse(metadata);
    config.connection.localRoot = 'docs/notes';
    await writeFile(
      join(project, '.bmad-project-ui/integrations/confluence.json'),
      JSON.stringify(config),
    );
    await dialog.getByRole('button', { name: 'Confirm import' }).click();
    await expect(
      page.getByText(
        'The binding or its scope changed after review. Compare again before applying.',
      ),
    ).toBeVisible();
    expect(await readFile(path, 'utf8')).toBe(saved);
    const reopened = await page.context().newPage();
    await installDiskPicker(reopened, project);
    await reopened.goto('/');
    await reopened.getByRole('button', { name: 'Choose project folder' }).click();
    await reopened.getByRole('switch', { name: 'Edit mode', exact: true }).click();
    await reopened.getByRole('button', { name: /Connect to Confluence/ }).click();
    await reopened.getByRole('button', { name: 'Set up connection', exact: true }).click();
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await reopened
      .getByLabel('Local connector address for Confluence')
      .fill(`http://127.0.0.1:${service.port}`);
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await reopened.getByLabel('Load session file for Confluence', { exact: true }).setInputFiles({
      name: 'session.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(service.token),
    });
    await reopened
      .getByRole('button', { name: 'Authorize connection to Confluence', exact: true })
      .click();
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await reopened.getByRole('button', { name: 'Check access and resource' }).click();
    await expect(
      reopened.getByText('Complete for the queried scope', { exact: true }),
    ).toBeVisible();
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await reopened.getByRole('button', { name: 'Save connection', exact: true }).click();
    await reopened.getByRole('button', { name: /docs\/notes\/meeting.md/ }).click();
    await reopened.getByRole('checkbox', { name: 'Title', exact: true }).uncheck();
    await reopened.getByRole('button', { name: 'Compare fields' }).click();
    await expect(
      reopened.getByRole('heading', { name: 'Remote changes', exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText(/Private baseline saved in this browser/)).toBeVisible();
    await reopened.close();
  } finally {
    await service.close();
  }
});

test('links a Jira story and imports only its reviewed YAML description without changing sibling bytes or the remote', async ({
  page,
  project,
}) => {
  const service = await mockAtlassian('jira');
  try {
    const container = '_bmad-output/specs/spec-notifications/stories.yaml',
      path = join(project, container),
      original = await readFile(path, 'utf8'),
      execution = join(
        project,
        '_bmad-output/specs/spec-notifications/stories/1-schedule-reminder.md',
      ),
      executionBefore = await readFile(execution, 'utf8'),
      sprint = join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml'),
      sprintBefore = await readFile(sprint, 'utf8'),
      remoteBefore = structuredClone(service.remote);
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose project folder' }).click();
    await page.getByRole('switch', { name: 'Edit mode', exact: true }).click();
    await page.getByRole('button', { name: /Connect to Jira/ }).click();
    await page.getByRole('button', { name: 'Set up connection', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page
      .getByLabel('Local connector address for Jira')
      .fill(`http://127.0.0.1:${service.port}`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Load session file for Jira', { exact: true }).setInputFiles({
      name: 'session.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(service.token),
    });
    await page.getByRole('button', { name: 'Authorize connection to Jira', exact: true }).click();
    await expect(page.getByText('E2E mock account', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check access and resource' }).click();
    await expect(page.getByText('Complete for the queried scope', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByText('Connected for reading', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Local item', exact: true })
      .selectOption({ label: '2 · Show reminder' });
    await page.getByRole('button', { name: 'Find candidates' }).click();
    await page.getByRole('button', { name: 'GARDEN-17 · Protected remote reminder' }).click();
    await page.getByRole('button', { name: 'Confirm link' }).click();
    await expect(page.getByText('Link saved. No content was published or imported.')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Title', exact: true }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Status', exact: true })).not.toBeChecked();
    await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('import');
    await page.getByRole('button', { name: 'Compare fields' }).click();
    await expect(
      page.getByRole('heading', { name: 'No common baseline', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Review import' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Local files that will change');
    await expect(dialog).toContainText(container);
    await expect(dialog).toContainText('Schedule reminder');
    await expect(dialog).toContainText('done_checkpoint: true');
    await expect(dialog.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    expect(await readFile(path, 'utf8')).toBe(original);
    await dialog.getByRole('button', { name: 'Confirm import' }).click();
    await expect(
      page.getByText('Import saved locally and verified. Git was not modified.'),
    ).toBeVisible();
    const expected = original.replace(
      'Show a local reminder without external delivery.',
      JSON.stringify(service.remote.content.markdown),
    );
    expect(await readFile(path, 'utf8')).toBe(expected);
    expect(await readFile(execution, 'utf8')).toBe(executionBefore);
    expect(await readFile(sprint, 'utf8')).toBe(sprintBefore);
    expect(service.writes).toBe(0);
    expect(service.remote).toEqual(remoteBefore);
    const rawMetadata = await readFile(
        join(project, '.bmad-project-ui/integrations/jira.json'),
        'utf8',
      ),
      metadata = JSON.parse(rawMetadata);
    expect(metadata.bindings).toHaveLength(1);
    expect(metadata.bindings[0].local.path).toBe(container);
    expect(metadata.bindings[0].local.entityId).toContain('#stories:2:');
    expect(rawMetadata).not.toContain(service.token);
    expect(rawMetadata).not.toContain('Reminder imported from Jira');
  } finally {
    await service.close();
  }
});
