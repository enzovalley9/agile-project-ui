import { test, expect } from '../e2e/filesystem';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  realpath,
  mkdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const git = async (root: string, ...args: string[]) =>
  (await exec('git', args, { cwd: root })).stdout.trim();

const image = process.env.AGILE_DOCKER_IMAGE ?? 'agile-project-ui:local';
const origin = 'http://127.0.0.1:8080';
const containers = new Set<string>();
const runtimeUser = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
async function startContainer(mode: string, args: string[] = []) {
  const name = `agile-docker-test-${randomUUID()}`;
  await exec('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--init',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--user',
    runtimeUser,
    ...args,
    ...(mode === 'git' ? ['--env', 'AGILE_GIT_ALLOW_MAPPED_OWNERSHIP=1'] : []),
    image,
    mode,
  ]);
  containers.add(name);
  return name;
}
async function stopContainer(name: string) {
  await exec('docker', ['rm', '--force', name]);
  containers.delete(name);
}
async function ready(url: string) {
  await expect
    .poll(
      () =>
        fetch(url)
          .then((r) => r.ok)
          .catch(() => false),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
}

test.beforeAll(async () => {
  await startContainer('web', ['--publish', '127.0.0.1:8080:8080']);
  await ready(origin + '/healthz');
});
test.afterAll(async () => {
  for (const name of containers) await stopContainer(name);
});

test('container serves the exact revision and public help without exposing runtime or private files', async ({
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
  await page.goto('/help/docker/');
  await expect(page.getByRole('main')).toContainText('Docker');
  await page.goto('/help/connector-setup/');
  await expect(page.getByRole('main')).toContainText('Git');
  await expect(page.getByRole('main')).toContainText('Confluence');
  for (const path of [
    '/.env',
    '/.git/config',
    '/AGENTS.md',
    '/docs/PRD.md',
    '/connectors/git.mjs',
    '/state/git-token',
    '/run/secrets/credentials.json',
    '/package.json',
  ])
    expect((await request.get(path)).status(), path).toBe(404);
});

test('container frontend saves disk files, binds the mounted repository and commits through Docker', async ({
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
  const state = await realpath(await mkdtemp(join(tmpdir(), 'docker-connector-')));
  await chmod(state, 0o700);
  const tokenFile = join(state, 'git-token');
  const port = 43120;
  const container = await startContainer('git', [
    '--publish',
    `127.0.0.1:${port}:${port}`,
    '--mount',
    `type=bind,src=${project},dst=/workspace`,
    '--mount',
    `type=bind,src=${state},dst=/state`,
    '--env',
    `AGILE_WEB_ORIGIN=${new URL(baseURL!).origin}`,
  ]);
  try {
    await expect
      .poll(async () => {
        return fetch(`http://127.0.0.1:${port}/v1/health`)
          .then((r) => r.ok)
          .catch(() => false);
      })
      .toBe(true);
    const sessionUrl = `http://127.0.0.1:${port}/v1/session`;
    const post = (headers: Record<string, string>) =>
      fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ trustRepository: true }),
      });
    expect((await post({ Origin: origin })).status).toBe(401);
    expect((await post({ Origin: 'https://untrusted.example' })).status).toBe(403);
    const forbiddenHost = await exec('docker', [
      'exec',
      container,
      'node',
      '-e',
      "require('node:http').get({hostname:'127.0.0.1',port:43120,path:'/v1/health',headers:{Host:'attacker.invalid:43120'}},r=>{console.log(r.statusCode);r.resume()})",
    ]);
    expect(forbiddenHost.stdout.trim()).toBe('403');
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
    const initialToken = await readFile(tokenFile, 'utf8');
    await exec('docker', ['restart', container]);
    await ready(`http://127.0.0.1:${port}/v1/health`);
    expect(await readFile(tokenFile, 'utf8')).toBe(initialToken);
    expect(await git(project, 'show', 'HEAD:docs/notes/meeting.md')).toBe(after.trimEnd());
    expect(failures).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { __cspFailures: string[] }).__cspFailures),
    ).toEqual([]);
  } finally {
    await stopContainer(container);
  }
});

for (const kind of ['branch', 'commit'] as const) {
  test(`interrupted ${kind} preserves journals and requires the appropriate offline recovery`, async ({
    project,
  }) => {
    await git(project, 'init', '-b', 'main');
    await git(project, 'config', 'user.name', 'Docker recovery fixture');
    await git(project, 'config', 'user.email', 'recovery@example.invalid');
    await writeFile(join(project, '.gitignore'), '.bmad-project-ui/local/\n');
    await git(project, 'add', '.');
    await git(project, 'commit', '-m', 'Recovery fixture baseline');
    const state = await realpath(await mkdtemp(join(tmpdir(), 'docker-recovery-')));
    await chmod(state, 0o700);
    const container = await startContainer('git', [
      '--publish',
      '127.0.0.1:43120:43120',
      '--mount',
      `type=bind,src=${project},dst=/workspace`,
      '--mount',
      `type=bind,src=${state},dst=/state`,
    ]);
    const context = { drafts: 0, saving: false, recoveryPending: false };
    let token = '',
      binding = '';
    const request = async (route: string, body?: unknown, expectedStatus = 200) => {
      const result = await fetch(`http://127.0.0.1:43120/v1/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Origin: origin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-BMAD-Binding': binding,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(
        result.status,
        `${route}: ${result.status === expectedStatus ? '' : await result.clone().text()}`,
      ).toBe(expectedStatus);
      return result.json();
    };
    const establish = async () => {
      await ready('http://127.0.0.1:43120/v1/health');
      token = (await readFile(join(state, 'git-token'), 'utf8')).trim();
      await request('session', { trustRepository: true });
      const challenge = await request('bindings/challenge', {});
      const marker = join(project, challenge.path);
      await mkdir(resolve(marker, '..'), { recursive: true });
      await writeFile(marker, challenge.content);
      binding = (await request('bindings/verify', { id: challenge.id })).bindingId;
      await unlink(marker);
    };
    try {
      await establish();
      const document = 'docs/notes/meeting.md';
      const content =
        (await readFile(join(project, document), 'utf8')) + '\nInterrupted operation fixture.\n';
      const hook = join(project, '.git/hooks', kind === 'commit' ? 'post-commit' : 'post-checkout');
      await writeFile(hook, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
      let plan;
      if (kind === 'commit') {
        await writeFile(join(project, document), content);
        plan = await request('plans/commit', {
          ...context,
          paths: [document],
          message: 'Commit before interrupted response',
        });
      } else {
        await git(project, 'branch', 'recovery-target');
        plan = await request('plans/branch', { ...context, branch: 'recovery-target' });
      }
      const interrupted = request('operations', { ...context, planId: plan.id }).catch(
        () => undefined,
      );
      if (kind === 'commit')
        await expect
          .poll(() => git(project, 'log', '-1', '--format=%s'))
          .toBe('Commit before interrupted response');
      else
        await expect.poll(() => git(project, 'branch', '--show-current')).toBe('recovery-target');
      await exec('docker', ['kill', '--signal', 'KILL', container]);
      await interrupted;
      const lockPath = join(state, 'journal/git/operation.lock');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      const journalPath = join(state, 'journal/git', `${lock.operationId}.json`);
      const journalBefore = await readFile(journalPath, 'utf8');
      expect(JSON.parse(journalBefore).operation.status).toBe('running');
      if (kind === 'commit')
        expect(await git(project, 'show', `HEAD:${document}`)).toBe(content.trimEnd());
      // Explicit offline operator recovery: this test owns the sole stopped connector.
      // Retain the app lock as evidence and never touch Git index/ref locks.
      await rename(lockPath, lockPath + '.offline-backup');
      expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);
      await unlink(hook);
      await exec('docker', ['start', container]);
      await establish();
      expect((await request(`operations/${lock.operationId}/reconcile`, {})).status).toBe(
        'verified',
      );
      if (kind === 'branch') {
        const next = await request('plans/branch', { ...context, branch: 'main' });
        expect((await request('operations', { ...context, planId: next.id })).status).toBe(
          'verified',
        );
        expect(await git(project, 'branch', '--show-current')).toBe('main');
      } else {
        // The commit was created using a private index. A kill before index
        // publication requires separate native Git recovery, never silent replay.
        const indexLock = await readFile(join(project, '.git/index.lock'));
        const privateIndex = await readFile(
          join(state, 'journal/git', `${lock.operationId}.index`),
        );
        const blocked = await request(
          'plans/commit',
          { ...context, paths: [document], message: 'Must remain blocked' },
          409,
        );
        expect(blocked.error.code).toBe('GIT_CONFLICT');
        expect(await readFile(join(project, '.git/index.lock'))).toEqual(indexLock);
        expect(await readFile(join(state, 'journal/git', `${lock.operationId}.index`))).toEqual(
          privateIndex,
        );
        expect(await git(project, 'rev-list', '--count', 'HEAD')).toBe('2');
      }
      expect(JSON.parse(await readFile(lockPath + '.offline-backup', 'utf8')).operationId).toBe(
        lock.operationId,
      );
    } finally {
      await stopContainer(container);
    }
  });
}

for (const [provider, port] of [
  ['jira', 43121],
  ['confluence', 43122],
] as const) {
  test(`${provider} container starts with private credentials and preserves its capability on restart`, async () => {
    const state = await realpath(await mkdtemp(join(tmpdir(), `docker-${provider}-`)));
    await chmod(state, 0o700);
    const credentialFile = join(state, 'credentials.json');
    await writeFile(credentialFile, JSON.stringify({ bearerToken: 'synthetic-offline-fixture' }), {
      mode: 0o600,
    });
    const container = await startContainer(provider, [
      '--publish',
      `127.0.0.1:${port}:${port}`,
      '--mount',
      `type=bind,src=${state},dst=/state`,
      '--mount',
      `type=bind,src=${credentialFile},dst=/run/secrets/credentials.json,readonly`,
      '--env',
      'AGILE_ATLASSIAN_INSTANCE=https://example.atlassian.net',
    ]);
    try {
      await ready(`http://127.0.0.1:${port}/v1/health`);
      const endpoint = `http://127.0.0.1:${port}/v1/session`;
      const post = (requestOrigin: string) =>
        fetch(endpoint, {
          method: 'POST',
          headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
          body: '{}',
        });
      expect((await post(origin)).status).toBe(401);
      expect((await post('https://untrusted.example')).status).toBe(403);
      const capability = join(state, `${provider}-token`);
      const before = await readFile(capability, 'utf8');
      expect(before.trim().length).toBeGreaterThanOrEqual(32);
      await exec('docker', ['restart', container]);
      await ready(`http://127.0.0.1:${port}/v1/health`);
      expect(await readFile(capability, 'utf8')).toBe(before);
      const config = JSON.parse((await exec('docker', ['inspect', container])).stdout)[0];
      expect(config.HostConfig.ReadonlyRootfs).toBe(true);
      expect(config.HostConfig.Privileged).toBe(false);
      expect(
        config.Mounts.find(
          (m: { Destination: string }) => m.Destination === '/run/secrets/credentials.json',
        ).RW,
      ).toBe(false);
      const logs = await exec('docker', ['logs', container]);
      expect(logs.stdout + logs.stderr).not.toContain(before.trim());
      expect(logs.stdout + logs.stderr).not.toContain('synthetic-offline-fixture');
    } finally {
      await stopContainer(container);
    }
  });
}
