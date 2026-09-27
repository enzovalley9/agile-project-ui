import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitClient,
  definitiveRejection,
  type GitOperation,
  type GitRepository,
  type MutationContext,
} from '../src/services/git-client';
import { ProjectStore, contentHash } from '../src/services/project-store';
import { memoryDirectory } from '../../../tests/support/memory-handles';

const context: MutationContext = { drafts: 0, saving: false, recoveryPending: false };
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
/** Deterministic Web Locks boundary shared by two browser-store instances. */
function webLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const requested: string[] = [];
  return {
    requested,
    request<T>(name: string, _options: unknown, callback: () => Promise<T>) {
      requested.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).catch(() => undefined).then(callback);
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}
function deferDocumentClose(
  handle: FileSystemDirectoryHandle,
  target: string,
  entered: () => void,
  release: Promise<void>,
  prefix = '',
): FileSystemDirectoryHandle {
  return new Proxy(handle, {
    get(object, key) {
      if (key === 'getDirectoryHandle')
        return async (name: string, options?: FileSystemGetDirectoryOptions) =>
          deferDocumentClose(
            await object.getDirectoryHandle(name, options),
            target,
            entered,
            release,
            prefix + name + '/',
          );
      if (key === 'getFileHandle')
        return async (name: string, options?: FileSystemGetFileOptions) => {
          const file = await object.getFileHandle(name, options);
          if (prefix + name !== target) return file;
          return new Proxy(file, {
            get(object, key) {
              if (key === 'createWritable')
                return async (options?: FileSystemCreateWritableOptions) => {
                  const stream = await object.createWritable(options);
                  return new Proxy(stream, {
                    get(object, key) {
                      if (key === 'close')
                        return async () => {
                          entered();
                          await release;
                          return object.close();
                        };
                      return Reflect.get(object, key);
                    },
                  });
                };
              return Reflect.get(object, key);
            },
          });
        };
      return Reflect.get(object, key);
    },
  });
}
async function fixture() {
  const locks = webLocks();
  vi.stubGlobal('navigator', { locks });
  const fs = memoryDirectory(
    { '.git/config': 'fixture marker only', 'docs/a.md': 'Original A', 'docs/b.md': 'Original B' },
    'shared-project',
  );
  const store = new ProjectStore(fs.handle);
  await store.setMode('edit');
  const repository: GitRepository = {
    rootName: 'shared-project',
    branch: 'main',
    head: 'a'.repeat(40),
    changes: [],
    conflicts: [],
    staged: [],
    dirty: false,
    remotes: [],
    operationInProgress: [],
    trusted: true,
  };
  const operation: GitOperation = {
    id: 'operation',
    planId: 'reviewed-plan',
    kind: 'branch',
    status: 'verified',
    startedAt: new Date().toISOString(),
    head: repository.head!,
  };
  const requests: (MutationContext & { planId: string })[] = [];
  const behavior = {
    execute: async (_body: MutationContext & { planId: string }) => Response.json(operation),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        ),
        method = init?.method ?? 'GET';
      if (url.pathname === '/v1/session') return Response.json({});
      if (url.pathname === '/v1/bindings/challenge')
        return Response.json({
          id: 'fixture',
          path: '.bmad-project-ui/local/git-bindings/fixture.json',
          content: 'fixture marker',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      if (url.pathname === '/v1/bindings/verify')
        return Response.json({ bindingId: 'fixture-binding', rootName: repository.rootName });
      if (url.pathname === '/v1/repository') return Response.json(repository);
      if (url.pathname === '/v1/operations' && method === 'GET')
        return Response.json({ operations: [], hasMore: false });
      if (url.pathname === '/v1/operations' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        return behavior.execute(body);
      }
      if (url.pathname === '/v1/operations/by-plan/reviewed-plan') return Response.json(operation);
      throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
    }),
  );
  const client = new GitClient();
  await client.connect(store, 'fixture-capability-never-real', true);
  return { fs, store, client, locks, repository, operation, requests, behavior };
}
afterEach(() => vi.unstubAllGlobals());

describe('browser writes and native Git coordination', () => {
  it('holds native execution until a different store finishes its document close', async () => {
    const f = await fixture(),
      entered = deferred(),
      release = deferred();
    const writer = new ProjectStore(
      deferDocumentClose(f.fs.handle, 'docs/a.md', () => entered.resolve(), release.promise),
    );
    await writer.setMode('edit');
    const save = writer.save('docs/a.md', 'Saved by another tab', await contentHash('Original A'));
    await entered.promise;
    f.behavior.execute = async () => {
      expect(f.fs.files.get('docs/a.md')).toBe('Saved by another tab');
      return Response.json(
        { error: { code: 'STALE_PLAN', message: 'The reviewed branch plan changed.' } },
        { status: 409 },
      );
    };
    const result = f.client.execute('reviewed-plan', context).catch((error) => error);
    expect(f.requests).toHaveLength(0);
    expect(f.fs.files.get('docs/a.md')).toBe('Original A');
    expect(f.locks.requested.slice(-2)).toEqual([
      'bmad-project:shared-project',
      'bmad-project:shared-project',
    ]);
    release.resolve();
    await save;
    const error = await result;
    expect(error).toMatchObject({ code: 'STALE_PLAN' });
    expect(definitiveRejection(error)).toBe(true);
    expect(f.requests).toHaveLength(1);
  });
  it('holds browser writes while the native execute request is in flight', async () => {
    const f = await fixture(),
      entered = deferred(),
      release = deferred();
    f.behavior.execute = async () => {
      entered.resolve();
      await release.promise;
      return Response.json(f.operation);
    };
    const native = f.client.execute('reviewed-plan', context);
    await entered.promise;
    const writer = new ProjectStore(f.fs.handle);
    await writer.setMode('edit');
    const save = writer.save('docs/a.md', 'After Git finishes', await contentHash('Original A'));
    expect(f.fs.files.get('docs/a.md')).toBe('Original A');
    release.resolve();
    expect((await native).status).toBe('verified');
    await save;
    expect(f.fs.files.get('docs/a.md')).toBe('After Git finishes');
  });
  it('rereads another store’s persisted recovery record inside the execution lock', async () => {
    const f = await fixture(),
      writer = new ProjectStore(f.fs.handle);
    await writer.setMode('edit');
    f.fs.state.beforeWrite = (path) => {
      if (path === 'docs/b.md') throw new Error('Simulated disk failure');
    };
    await expect(
      writer.applyChanges([
        {
          path: 'docs/a.md',
          before: 'Original A',
          after: 'Saved A',
          expectedRevision: await contentHash('Original A'),
        },
        {
          path: 'docs/b.md',
          before: 'Original B',
          after: 'Planned B',
          expectedRevision: await contentHash('Original B'),
        },
      ]),
    ).rejects.toThrow('interrupted');
    expect(f.store.recoveryPending).toBe(false);
    f.behavior.execute = async (body) => {
      expect(body.recoveryPending).toBe(true);
      return Response.json(
        { error: { code: 'SAVE_IN_PROGRESS', message: 'Recover browser saves first.' } },
        { status: 409 },
      );
    };
    await expect(f.client.execute('reviewed-plan', context)).rejects.toMatchObject({
      code: 'SAVE_IN_PROGRESS',
    });
    expect(f.store.recoveryPending).toBe(true);
    expect(f.requests).toHaveLength(1);
    expect(f.fs.files.get('docs/b.md')).toBe('Original B');
  });
});

describe('definitive rejection versus lost operation response', () => {
  it.each([
    'STALE_PLAN',
    'PLAN_EXPIRED',
    'SESSION_REQUIRED',
    'AUTH_REQUIRED',
    'HOST_DENIED',
    'ORIGIN_DENIED',
    'GIT_CONFLICT',
    'REPOSITORY_CHANGED',
  ])('keeps document saves available after %s without an operation', async (code) => {
    const f = await fixture();
    f.behavior.execute = async () =>
      Response.json({ error: { code, message: 'Review again.' } }, { status: 409 });
    await expect(f.client.execute('reviewed-plan', context)).rejects.toMatchObject({ code });
    await f.store.save('docs/a.md', 'Still editable', await contentHash('Original A'));
    expect(f.fs.files.get('docs/a.md')).toBe('Still editable');
    expect(f.requests).toHaveLength(1);
  });
  it('blocks saves after transport loss until the existing operation is observed, without replay', async () => {
    const f = await fixture();
    f.behavior.execute = async () => {
      throw new TypeError('Simulated response loss');
    };
    await expect(f.client.execute('reviewed-plan', context)).rejects.toMatchObject({
      code: 'unreachable',
    });
    await expect(
      f.store.save('docs/a.md', 'Must wait', await contentHash('Original A')),
    ).rejects.toMatchObject({ code: 'recovery-pending' });
    expect(f.fs.files.get('docs/a.md')).toBe('Original A');
    expect(f.requests).toHaveLength(1);
    expect((await f.client.operationByPlan('reviewed-plan')).status).toBe('verified');
    await f.store.save('docs/a.md', 'After reconciliation', await contentHash('Original A'));
    expect(f.fs.files.get('docs/a.md')).toBe('After reconciliation');
    expect(f.requests).toHaveLength(1);
  });
});
