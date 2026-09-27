import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtimeConfiguration, requirePrivateState } from './runtime.mjs';
import { startWebServer } from './web-server.mjs';
import { buildRevision } from '../scripts/build-revision.mjs';

let directory, server, port;
before(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'agile-docker-runtime-')));
  await mkdir(path.join(directory, 'web/assets'), { recursive: true });
  await mkdir(path.join(directory, 'web/help'));
  await copyFile(
    new URL('../apps/web/public/_headers', import.meta.url),
    path.join(directory, 'web/_headers'),
  );
  await writeFile(
    path.join(directory, 'web/index.html'),
    '<!doctype html><title>Agile Project UI</title>',
  );
  await writeFile(path.join(directory, 'web/help/index.html'), '<title>Help</title>');
  await writeFile(path.join(directory, 'web/assets/app.js'), 'export const value = 1;');
  await writeFile(path.join(directory, 'web/assets/app.js.map'), 'private-source');
  await writeFile(path.join(directory, 'private.md'), 'outside-secret');
  await writeFile(path.join(directory, 'web/.env'), 'secret');
  await symlink(path.join(directory, 'private.md'), path.join(directory, 'web/leak.md'));
  server = await startWebServer({
    root: path.join(directory, 'web'),
    hostname: '127.0.0.1',
    port: 0,
    signals: false,
    origin: 'http://127.0.0.1:9090',
  });
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});
function probe(route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: route, ...options }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('image service modes preserve exact ports, private files and independent provider journals', () => {
  assert.equal(runtimeConfiguration(undefined, {}).port, 8080);
  const git = runtimeConfiguration('git', {});
  assert.deepEqual(git.args, [
    '--origin',
    'http://127.0.0.1:8080',
    '--listen-host',
    '0.0.0.0',
    '--port',
    '43120',
    '--token-file',
    '/state/git-token',
    '--repo',
    '/workspace',
    '--state-directory',
    '/state/journal/git',
  ]);
  const mapped = runtimeConfiguration('git', { AGILE_GIT_ALLOW_MAPPED_OWNERSHIP: '1' });
  assert.equal(mapped.args[mapped.args.indexOf('--allow-mapped-ownership') + 1], 'true');
  assert.equal(
    runtimeConfiguration('git', { AGILE_GIT_ALLOW_MAPPED_OWNERSHIP: '0' }).args.includes(
      '--allow-mapped-ownership',
    ),
    false,
  );
  for (const [mode, expected] of [
    ['jira', 43121],
    ['confluence', 43122],
  ]) {
    const value = runtimeConfiguration(mode, {
      AGILE_ATLASSIAN_INSTANCE: 'https://example.atlassian.net',
    });
    assert.equal(value.port, expected);
    assert.equal(
      value.args[value.args.indexOf('--credentials-file') + 1],
      '/run/secrets/credentials.json',
    );
    assert.equal(
      value.args[value.args.indexOf('--journal-directory') + 1],
      `/state/journal/${mode}`,
    );
  }
});
test('runtime rejects malformed origins, paths and provider configuration', () => {
  for (const origin of [
    '*',
    'http://192.0.2.1',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com/',
  ])
    assert.throws(() => runtimeConfiguration('git', { AGILE_WEB_ORIGIN: origin }));
  assert.throws(() => runtimeConfiguration('shell', {}));
  for (const value of ['', 'true', '*', '/workspace'])
    assert.throws(() => runtimeConfiguration('git', { AGILE_GIT_ALLOW_MAPPED_OWNERSHIP: value }));
  assert.throws(() => runtimeConfiguration('git', { AGILE_REPO_PATH: 'relative' }));
  assert.throws(() => runtimeConfiguration('git', { AGILE_STATE_DIR: '/workspace/state' }));
  assert.throws(() => runtimeConfiguration('jira', {}));
  assert.throws(() =>
    runtimeConfiguration('jira', { AGILE_ATLASSIAN_INSTANCE: 'http://example.com' }),
  );
  assert.throws(() =>
    runtimeConfiguration('jira', {
      AGILE_ATLASSIAN_INSTANCE: 'https://example.com',
      AGILE_ATLASSIAN_DEPLOYMENT: 'server',
    }),
  );
});
test('state creation is private and refuses shared or symlinked directories', async () => {
  const state = path.join(directory, 'private-state');
  await requirePrivateState(state);
  assert.equal((await stat(state)).mode & 0o777, 0o700);
  if (process.platform !== 'win32') {
    await chmod(state, 0o755);
    await assert.rejects(requirePrivateState(state), /private directory/);
    await chmod(state, 0o700);
  }
  const linked = path.join(directory, 'linked-state');
  await symlink(state, linked);
  await assert.rejects(requirePrivateState(linked), /private directory/);
});
test('build revision accepts only exact full SHA metadata without requiring Git history', () => {
  const revision = 'a'.repeat(40);
  assert.equal(
    buildRevision('/missing-build-context', { AGILE_PROJECT_UI_BUILD_REVISION: revision }),
    revision,
  );
  for (const value of ['', 'abc', 'A'.repeat(40), revision + '\n'])
    assert.throws(() =>
      buildRevision('/missing-build-context', { AGILE_PROJECT_UI_BUILD_REVISION: value }),
    );
});
test('web server serves app and help with maintained CSP and appropriate caching', async () => {
  const app = await probe('/');
  assert.equal(app.status, 200);
  assert.match(app.body, /Agile Project UI/);
  assert.match(
    app.headers['content-security-policy'],
    /connect-src 'self' http:\/\/127\.0\.0\.1:\*/,
  );
  assert.equal(app.headers['x-content-type-options'], 'nosniff');
  assert.equal(app.headers['x-frame-options'], 'DENY');
  assert.equal(app.headers['cache-control'], 'no-store');
  assert.equal((await probe('/help/')).status, 200);
  assert.equal((await probe('/', { headers: { Host: '127.0.0.1:9090' } })).status, 200);
  assert.equal((await probe('/', { headers: { Host: '127.0.0.1:9091' } })).status, 403);
  assert.equal((await probe('/healthz')).status, 200);
  assert.equal(
    (await probe('/assets/app.js')).headers['cache-control'],
    'public, max-age=31536000, immutable',
  );
  const head = await probe('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.ok(Number(head.headers['content-length']) > 0);
});
test('web server denies DNS rebinding, mutations, traversal, secrets and symlinks', async () => {
  assert.equal((await probe('/', { headers: { Host: `evil.example:${port}` } })).status, 403);
  const write = await probe('/', { method: 'POST' });
  assert.equal(write.status, 405);
  assert.equal(write.headers.allow, 'GET, HEAD');
  for (const route of [
    '/../private.md',
    '/%2e%2e/private.md',
    '/%2eenv',
    '/.env',
    '/leak.md',
    '/_headers',
    '/assets/app.js.map',
    '/%5c..%5cprivate.md',
    '/%00',
    '/%',
    '/missing',
  ]) {
    const response = await probe(route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.body, /outside-secret|private-source/);
  }
});
