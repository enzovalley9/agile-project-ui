import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArguments } from '../src/cli';
import { nativeGitRunner } from '../src/runner';
import { GitService } from '../src/service';
import type { GitRunner } from '../src/types';

const required = [
  '--repo',
  '/workspace',
  '--origin',
  'http://127.0.0.1:8080',
  '--token-file',
  '/state/git-token',
];
afterEach(() => vi.unstubAllEnvs());

describe('Git connector container arguments', () => {
  it('defaults to loopback and explicitly opts into container listening', () => {
    expect(parseArguments(required)).toMatchObject({
      listenHost: '127.0.0.1',
      port: 43120,
      allowMappedOwnership: false,
    });
    expect(
      parseArguments([
        ...required,
        '--listen-host',
        '0.0.0.0',
        '--state-directory',
        '/state/journal/git',
      ]),
    ).toMatchObject({ listenHost: '0.0.0.0', stateDir: resolve('/state/journal/git') });
  });
  it.each(['::', 'localhost', '192.0.2.1', '*', '0.0.0.0; echo unsafe'])(
    'rejects unsupported listen host %s',
    (value) => {
      expect(() => parseArguments([...required, '--listen-host', value])).toThrow(/Listen host/);
    },
  );
  it('requires an explicit boolean for mapped ownership', () => {
    expect(
      parseArguments([...required, '--allow-mapped-ownership', 'true']).allowMappedOwnership,
    ).toBe(true);
    expect(
      parseArguments([...required, '--allow-mapped-ownership', 'false']).allowMappedOwnership,
    ).toBe(false);
    for (const value of ['1', 'yes', '/workspace', '*'])
      expect(() => parseArguments([...required, '--allow-mapped-ownership', value])).toThrow(
        /Mapped ownership/,
      );
  });
  it('passes commit identity while stripping inherited Git routing overrides', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'agile-docker-identity-'));
    try {
      vi.stubEnv('GIT_AUTHOR_NAME', 'Container Test Author');
      vi.stubEnv('GIT_AUTHOR_EMAIL', 'container-author@example.invalid');
      vi.stubEnv('GIT_COMMITTER_NAME', 'Container Test Committer');
      vi.stubEnv('GIT_COMMITTER_EMAIL', 'container-committer@example.invalid');
      vi.stubEnv('GIT_DIR', join(repo, 'missing-git-directory'));
      const options = { cwd: repo, timeoutMs: 5000 };
      const init = await nativeGitRunner(['init', '.'], options);
      expect(init.exitCode).toBe(0);
      const author = await nativeGitRunner(['var', 'GIT_AUTHOR_IDENT'], options);
      expect(author.exitCode).toBe(0);
      expect(author.stdout).toContain('Container Test Author <container-author@example.invalid>');
      const committer = await nativeGitRunner(['var', 'GIT_COMMITTER_IDENT'], options);
      expect(committer.exitCode).toBe(0);
      expect(committer.stdout).toContain(
        'Container Test Committer <container-committer@example.invalid>',
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

it('opts into mapped ownership only for the canonical mounted repository', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agile-mapped-ownership-')));
  const repo = join(root, 'repo');
  const other = join(root, 'other');
  const config = join(root, 'empty-gitconfig');
  const calls: string[][] = [];
  try {
    await mkdir(repo);
    await mkdir(other);
    await writeFile(config, '');
    const isolatedEnv = { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
    for (const cwd of [repo, other]) {
      const result = await nativeGitRunner(['init', '.'], {
        cwd,
        timeoutMs: 5000,
        env: isolatedEnv,
      });
      expect(result.exitCode).toBe(0);
    }
    const runner: GitRunner = (args, options) => {
      calls.push(args);
      return nativeGitRunner(args, {
        ...options,
        env: { ...options.env, ...isolatedEnv, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' },
      });
    };
    const defaults = {
      repo,
      origin: 'http://127.0.0.1:8080',
      token: 'a'.repeat(64),
      stateDir: join(root, 'state'),
      runner,
    };
    await expect(new GitService(defaults).ready).rejects.toMatchObject({
      code: 'UNTRUSTED_OWNERSHIP',
    });
    expect(calls.flat().some((value) => value.startsWith('safe.directory='))).toBe(false);
    calls.length = 0;
    const allowed = new GitService({ ...defaults, allowMappedOwnership: true });
    await expect(allowed.ready).resolves.toBeUndefined();
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((args) => args.includes(`safe.directory=${repo}`))).toBe(true);
    expect(calls.flat()).not.toContain('safe.directory=*');
    const unrelated = await nativeGitRunner(
      ['-c', `safe.directory=${repo}`, 'rev-parse', '--show-toplevel'],
      {
        cwd: other,
        timeoutMs: 5000,
        env: { ...isolatedEnv, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' },
      },
    );
    expect(unrelated.exitCode).not.toBe(0);
    expect(unrelated.stderr).toMatch(/dubious ownership/);
    if (process.platform !== 'win32') {
      const wildcard = join(root, '*');
      await mkdir(wildcard);
      await expect(
        new GitService({ ...defaults, repo: wildcard, allowMappedOwnership: true }).ready,
      ).rejects.toMatchObject({ code: 'ROOT_REQUIRED' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
