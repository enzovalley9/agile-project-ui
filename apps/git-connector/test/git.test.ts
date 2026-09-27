import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitApp } from '../src/app';
import { GitError } from '../src/errors';
import { nativeGitRunner } from '../src/runner';
import type { GitOptions, GitPlan, GitOperation, GitRunner } from '../src/types';
import { parseArguments } from '../src/cli';

const exec = promisify(execFile); const roots: string[] = [];
const context = { drafts: 0, saving: false, recoveryPending: false };
const origin = 'http://localhost:5173'; const token = 'a'.repeat(64);
async function git(repo: string, args: string[]) { return (await exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: repo, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trimEnd(); }
async function fixture(options: Partial<GitOptions> = {}, initialCommit = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bmad-git-test-')); roots.push(root);
  const repo = path.join(root, 'project'); await fs.mkdir(repo);
  await git(repo, ['init', '-b', 'main']); await git(repo, ['config', 'user.name', 'Fixture Author']); await git(repo, ['config', 'user.email', 'fixture@example.invalid']); await git(repo, ['config', 'commit.gpgsign', 'false']); await git(repo, ['config', 'core.hooksPath', path.join(repo, '.git', 'hooks')]);
  await fs.writeFile(path.join(repo, '.gitignore'), '.bmad-project-ui/local/\n');
  await fs.writeFile(path.join(repo, 'prd.md'), '# Test project\n');
  if (initialCommit) { await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'Initial fixture']); }
  const app = createGitApp({ repo, origin, token, stateDir: path.join(root, 'private'), allowLocalRemotes: true, ...options, runner: (args, config) => (options.runner ?? nativeGitRunner)(args, { ...config, env: { ...config.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } }) }); await app.service.ready;
  let binding = '';
  const request = async (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => app.request(`http://127.0.0.1:43120/v1/${route}`, { method, headers: { Origin: origin, Authorization: `Bearer ${token}`, 'X-BMAD-Binding': binding, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const establish = async (trusted = true) => {
    expect((await request('session', 'POST', { trustRepository: trusted })).status).toBe(200);
    const challenge = await (await request('bindings/challenge', 'POST', {})).json() as { id: string; path: string; content: string };
    await fs.mkdir(path.dirname(path.join(repo, challenge.path)), { recursive: true }); await fs.writeFile(path.join(repo, challenge.path), challenge.content);
    const result = await (await request('bindings/verify', 'POST', { id: challenge.id })).json() as { bindingId: string };
    binding = result.bindingId; await fs.unlink(path.join(repo, challenge.path));
  };
  const planCommit = async (paths = ['prd.md'], message = 'Update project') => {
    const response = await request('plans/commit', 'POST', { ...context, paths, message });
    expect(response.status, await response.clone().text()).toBe(200); return await response.json() as GitPlan;
  };
  const execute = async (plan: GitPlan) => {
    const response = await request('operations', 'POST', { ...context, planId: plan.id });
    expect(response.status, await response.clone().text()).toBe(200); return await response.json() as GitOperation;
  };
  await establish(); return { root, repo, app, request, establish, planCommit, execute };
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('Git connector capability and repository binding', () => {
  it('requires exact Host, Origin, local capability and a live binding', async () => {
    const f = await fixture();
    expect((await f.request('health')).status).toBe(200);
    expect((await f.request('health')).headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect((await f.request('session', 'POST', { trustRepository: true, padding: 'a'.repeat(70_000) })).status).toBe(413);
    expect((await f.request('repository', 'GET', undefined, { Host: 'evil.example:43120' })).status).toBe(403);
    expect((await f.request('repository', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await f.request('repository', 'GET', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await f.request('repository', 'GET', undefined, { 'X-BMAD-Binding': 'wrong' })).status).toBe(403);
    expect((await f.request('files')).status).toBe(404);
    expect((await f.request('session', 'DELETE')).status).toBe(200);
    expect((await f.request('repository')).status).toBe(401);
  });
  it('rejects a challenge for a different folder and consumes it only after success', async () => {
    const f = await fixture();
    const challenge = await (await f.request('bindings/challenge', 'POST', {})).json() as { id: string; path: string; content: string };
    await fs.mkdir(path.dirname(path.join(f.repo, challenge.path)), { recursive: true });
    await fs.writeFile(path.join(f.repo, challenge.path), 'wrong');
    const result = await f.request('bindings/verify', 'POST', { id: challenge.id }); expect(result.status).toBe(403);
    await fs.writeFile(path.join(f.repo, challenge.path), challenge.content);
    expect((await f.request('bindings/verify', 'POST', { id: challenge.id })).status).toBe(200);
    expect((await f.request('bindings/verify', 'POST', { id: challenge.id })).status).toBe(409);
  });
  it.skipIf(process.platform === 'win32')('rejects symlinks and unsupported routes, without reading their target', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, 'outside.txt'), 'outside'); await fs.symlink(path.join(f.root, 'outside.txt'), path.join(f.repo, 'escape.md'));
    const response = await f.request('plans/commit', 'POST', { ...context, paths: ['escape.md'], message: 'Escape' });
    expect(response.status).toBe(403); expect((await response.json() as { error: { code: string } }).error.code).toBe('SYMLINK_REJECTED');
    expect(await fs.readFile(path.join(f.root, 'outside.txt'), 'utf8')).toBe('outside');
  });
  it('leaves reading usable without trust but blocks mutation and native helpers', async () => {
    const f = await fixture(); await f.establish(false); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed');
    expect((await f.request('repository')).status).toBe(200);
    const response = await f.request('plans/commit', 'POST', { ...context, paths: ['prd.md'], message: 'Update' });
    expect(response.status).toBe(403);
  });
  it('does not execute configured content filters while querying an untrusted repository', async () => {
    const f = await fixture(); await git(f.repo, ['config', 'filter.fake.clean', 'touch FILTER_EXECUTED']); await fs.writeFile(path.join(f.repo, '.gitattributes'), '*.md filter=fake\n'); await f.establish(false);
    const result = await f.request('repository'); expect(result.status).toBe(403); expect((await result.json() as { error: { code: string } }).error.code).toBe('TRUST_REQUIRED');
    await expect(fs.stat(path.join(f.repo, 'FILTER_EXECUTED'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('has strict CLI arguments and never accepts arbitrary commands', () => {
    expect(parseArguments(['--repo', '/tmp/project', '--origin', origin, '--token-file', '/tmp/token']).port).toBe(43120);
    expect(() => parseArguments(['--repo', '/tmp/project', '--origin', origin, '--token-file', '/tmp/token', '--command', 'whoami'])).toThrow();
    expect(() => parseArguments(['--repo', '/tmp/project', '--origin', origin, '--token-file', '/tmp/token', '--port', '80'])).toThrow();
  });
  it('rejects secret paths before reading their diff and preserves unreviewable untracked bytes', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, '.env.example'), 'PRIVATE_FIXTURE_CONTENT');
    const secret = await f.request('plans/commit', 'POST', {...context, paths:['.env.example'], message:'Unsafe'});
    expect(secret.status).toBe(403); expect(await secret.text()).not.toContain('PRIVATE_FIXTURE_CONTENT');
    const bytes = Buffer.from([0xff, 0xfe, 0x61]); await fs.writeFile(path.join(f.repo, 'invalid.md'), bytes);
    const binary = await f.request('plans/commit', 'POST', {...context, paths:['invalid.md'], message:'Unsafe'});
    expect((await binary.json() as {error:{code:string}}).error.code).toBe('UNREVIEWABLE_FILE');
    expect(await fs.readFile(path.join(f.repo, 'invalid.md'))).toEqual(bytes); expect(await git(f.repo, ['diff', '--cached', '--name-only'])).toBe('');
  });
  it('redacts SSH credentials and URL query data and refuses to use them', async () => {
    const f = await fixture(); await git(f.repo, ['remote', 'add', 'origin', 'ssh://git:fixture-password@example.invalid/project.git?private=value#fragment']);
    const display = await (await f.request('repository')).text();
    expect(display).not.toContain('fixture-password'); expect(display).not.toContain('private=value'); expect(display).not.toContain('fragment');
    const response = await f.request('plans/push', 'POST', {...context, remote:'origin', branch:'main'});
    expect((await response.json() as {error:{code:string}}).error.code).toBe('EMBEDDED_CREDENTIALS');
  });
});

describe('reviewed commits and concurrent changes', () => {
  it('verifies the first commit in an unborn branch', async () => {
    const f = await fixture({}, false); const plan = await f.planCommit(['prd.md'], 'First project commit');
    expect(plan.head).toBeNull(); const result = await f.execute(plan); expect(result.status).toBe('verified');
    expect(await git(f.repo, ['rev-list', '--count', 'HEAD'])).toBe('1'); expect(await git(f.repo, ['show', '--format=', '--name-only', 'HEAD'])).toBe('prd.md');
  });
  it('commits only reviewed files, leaves unrelated working files and deduplicates requests', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'prd.md'), '# Changed\n'); await fs.writeFile(path.join(f.repo, 'unrelated.txt'), 'keep');
    const plan = await f.planCommit(); expect(plan.files[0].diff).toContain('# Changed');
    const result = await f.execute(plan); expect(result.status).toBe('verified');
    expect(await git(f.repo, ['show', '--format=', '--name-only', 'HEAD'])).toBe('prd.md');
    expect(await git(f.repo, ['status', '--porcelain'])).toContain('?? unrelated.txt');
    expect(await f.execute(plan)).toEqual(result);
    expect(await (await f.request(`operations/by-plan/${plan.id}`)).json()).toEqual(result);
    expect(await git(f.repo, ['rev-list', '--count', 'HEAD'])).toBe('2');
  });
  it('preserves the foreign index byte-for-byte and blocks the commit', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'foreign.md'), 'foreign'); await git(f.repo, ['add', 'foreign.md']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed'); const before = await fs.readFile(path.join(f.repo, '.git', 'index'));
    const response = await f.request('plans/commit', 'POST', { ...context, paths: ['prd.md'], message: 'Update' });
    expect((await response.json() as { error: { code: string } }).error.code).toBe('FOREIGN_INDEX');
    expect(await fs.readFile(path.join(f.repo, '.git', 'index'))).toEqual(before);
  });
  it('invalidates a review after file contents or index change', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'prd.md'), 'First'); const plan = await f.planCommit();
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Second');
    const response = await f.request('operations', 'POST', { ...context, planId: plan.id });
    expect((await response.json() as { error: { code: string } }).error.code).toBe('STALE_PLAN');
    expect(await git(f.repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });
  it('checks current drafts again at execution and expires plans', async () => {
    let time = Date.now(); const f = await fixture({ now: () => time, planTtlMs: 10 }); await fs.writeFile(path.join(f.repo, 'prd.md'), 'First'); const plan = await f.planCommit();
    const draft = await f.request('operations', 'POST', { ...context, drafts: 1, planId: plan.id }); expect(draft.status).toBe(409);
    time += 11; const stale = await f.request('operations', 'POST', { ...context, planId: plan.id });
    expect((await stale.json() as { error: { code: string } }).error.code).toBe('PLAN_EXPIRED');
  });
  it('blocks mutation when a prior private operation journal is corrupt', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed');
    await fs.writeFile(path.join(f.root, 'private', '11111111-1111-1111-1111-111111111111.json'), '{broken');
    const service = createGitApp({ repo: f.repo, origin, token, stateDir: path.join(f.root, 'private') }).service; await service.ready; service.session(true);
    expect((await service.repository()).head).toBeTruthy();
    await expect(service.planCommit({ ...context, paths: ['prd.md'], message: 'Update' })).rejects.toMatchObject({ code: 'CORRUPT_JOURNAL' });
  });
  it('fails closed for a valid JSON journal with an unknown operation status', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'prd.md'), 'First'); const result = await f.execute(await f.planCommit());
    const file = path.join(f.root, 'private', `${result.id}.json`); const journal = JSON.parse(await fs.readFile(file, 'utf8')); journal.operation.status = 'probably-finished';
    await fs.writeFile(file, JSON.stringify(journal)); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Second');
    const response = await f.request('plans/commit', 'POST', {...context, paths:['prd.md'], message:'Next'});
    expect((await response.json() as {error:{code:string}}).error.code).toBe('CORRUPT_JOURNAL');
    expect(await git(f.repo, ['rev-list', '--count', 'HEAD'])).toBe('2');
  });
  it.skipIf(process.platform === 'win32')('handles new files, deletion, spaces, leading dashes and newline filenames without shell interpolation', async () => {
    const f = await fixture(); const strange = '-new $(touch NO).\nmd'; await fs.writeFile(path.join(f.repo, strange), 'literal'); await fs.unlink(path.join(f.repo, 'prd.md'));
    const plan = await f.planCommit([strange, 'prd.md'], 'Literal $(touch NO)'); const operation = await f.execute(plan);
    expect(operation.status).toBe('verified'); expect(await git(f.repo, ['show', `HEAD:${strange}`])).toBe('literal');
    await expect(fs.stat(path.join(f.repo, 'NO'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(f.repo, ['status', '--porcelain'])).toBe('');
  });
  it.skipIf(process.platform === 'win32')('treats Git pathspec magic as a literal filename', async () => {
    const f = await fixture(); const special = ':(glob)*'; await fs.writeFile(path.join(f.repo, special), 'literal file'); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Unreviewed');
    const result = await f.execute(await f.planCommit([special])); expect(result.status).toBe('verified');
    expect(await git(f.repo, ['show', `HEAD:${special}`])).toBe('literal file'); expect(await git(f.repo, ['show', 'HEAD:prd.md'])).toBe('# Test project');
  });
  it('does not remove Git locks and reports hooks failure while preserving local changes', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed');
    await fs.writeFile(path.join(f.repo, '.git', 'index.lock'), 'owned elsewhere');
    expect((await f.request('plans/commit', 'POST', { ...context, paths: ['prd.md'], message: 'Update' })).status).toBe(409);
    expect(await fs.readFile(path.join(f.repo, '.git', 'index.lock'), 'utf8')).toBe('owned elsewhere');
    await fs.unlink(path.join(f.repo, '.git', 'index.lock'));
    const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit'); await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const result = await f.execute(await f.planCommit()); expect(result.status).toBe('rejected');
    expect(await fs.readFile(path.join(f.repo, 'prd.md'), 'utf8')).toBe('Changed');
    expect(await git(f.repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });
  it('recovers a commit accepted before the command response was lost and persists its result', async () => {
    const runner: GitRunner = async (args, options) => { const result = await nativeGitRunner(args, options); if (args.includes('commit')) throw new GitError('TIMEOUT', 'Command timed out.'); return result; };
    const f = await fixture({ runner }); await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed');
    const result = await f.execute(await f.planCommit()); expect(result.status).toBe('verified');
    const restarted = createGitApp({ repo: f.repo, origin, token, stateDir: path.join(f.root, 'private') }); await restarted.service.ready;
    expect((await restarted.service.operation(result.id)).status).toBe('verified');
    expect((await restarted.service.operationByPlan(result.planId)).id).toBe(result.id);
    expect((await restarted.service.operations()).operations).toEqual([result]);
    expect((await (await f.request('operations')).json() as { operations: GitOperation[] }).operations).toEqual([result]);
    const journal = await fs.readFile(path.join(f.root, 'private', `${result.id}.json`), 'utf8'); expect(journal).not.toContain('diff --git'); expect(journal).not.toContain(token);
  });
});

describe('branch protections and native push verification', () => {
  it('switches an existing clean branch and blocks drafts, dirty state and occupied worktrees', async () => {
    const f = await fixture(); await git(f.repo, ['branch', 'feature']);
    const response = await f.request('plans/branch', 'POST', { ...context, branch: 'feature' }); expect(response.status).toBe(200);
    const result = await f.execute(await response.json() as GitPlan); expect(result.status).toBe('verified'); expect(await git(f.repo, ['branch', '--show-current'])).toBe('feature');
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Dirty'); expect((await f.request('plans/branch', 'POST', { ...context, branch: 'main' })).status).toBe(409);
    await git(f.repo, ['restore', 'prd.md']); await git(f.repo, ['worktree', 'add', path.join(f.root, 'another'), 'main']);
    const occupied = await f.request('plans/branch', 'POST', { ...context, branch: 'main' }); expect((await occupied.json() as { error: { code: string } }).error.code).toBe('BRANCH_IN_USE');
  });
  it('reviews every outgoing commit including transient deleted files and pushes only the reviewed ref', async () => {
    const f = await fixture(); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    await fs.writeFile(path.join(f.repo, 'temporary.md'), 'later removed'); await git(f.repo, ['add', '.']); await git(f.repo, ['commit', '-m', 'Add transient file']);
    await fs.unlink(path.join(f.repo, 'temporary.md')); await git(f.repo, ['add', '.']); await git(f.repo, ['commit', '-m', 'Remove transient file']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Saved local draft');
    const response = await f.request('plans/push', 'POST', { ...context, drafts: 1, remote: 'origin', branch: 'main' }); expect(response.status, await response.clone().text()).toBe(200);
    const plan = await response.json() as GitPlan; expect(plan.commits).toHaveLength(2); expect(plan.files.filter((file) => file.path === 'temporary.md')).toHaveLength(2);
    const result = await f.execute(plan); expect(result.status).toBe('verified');
    expect(await git(remote, ['rev-parse', 'refs/heads/main'])).toBe(await git(f.repo, ['rev-parse', 'HEAD']));
    expect(await fs.readFile(path.join(f.repo, 'prd.md'), 'utf8')).toBe('Saved local draft');
  });
  it('blocks secrets in an outgoing commit even when they were deleted later', async () => {
    const f = await fixture(); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    const before = await git(remote, ['rev-parse', 'refs/heads/main']);
    await fs.writeFile(path.join(f.repo, '.env'), 'FIXTURE_PRIVATE_BYTES'); await git(f.repo, ['add', '.env']); await git(f.repo, ['commit', '-m', 'Bad historical file']);
    await fs.unlink(path.join(f.repo, '.env')); await git(f.repo, ['add', '-u']); await git(f.repo, ['commit', '-m', 'Remove historical file']);
    const response = await f.request('plans/push', 'POST', {...context, remote:'origin', branch:'main'});
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('FIXTURE_PRIVATE_BYTES'); expect(await git(remote, ['rev-parse', 'refs/heads/main'])).toBe(before);
  });
  it('rejects a second destination rewrite before invoking any remote transport', async () => {
    const f = await fixture(); await git(f.repo, ['remote', 'add', 'origin', 'https://first.invalid/repo.git']);
    await git(f.repo, ['config', 'url.https://second.invalid/.insteadOf', 'https://first.invalid/']);
    await git(f.repo, ['config', 'url.https://third.invalid/.insteadOf', 'https://second.invalid/']);
    const response = await f.request('plans/push', 'POST', {...context, remote:'origin', branch:'main'});
    expect((await response.json() as {error:{code:string}}).error.code).toBe('REMOTE_REWRITE');
  });
  it('invalidates a changed destination and never creates an unreviewed remote branch', async () => {
    const f = await fixture(); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed'); await f.execute(await f.planCommit());
    const missing = await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'new' }); expect(missing.status).toBe(409);
    const plan = await (await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'main' })).json() as GitPlan;
    await git(f.repo, ['config', 'remote.origin.pushurl', path.join(f.root, 'changed.git')]);
    const response = await f.request('operations', 'POST', { ...context, planId: plan.id }); expect((await response.json() as { error: { code: string } }).error.code).toBe('STALE_PLAN');
  });
  it('recognizes a push accepted before timeout, with no second push', async () => {
    let pushes = 0;
    const runner: GitRunner = async (args, options) => { const result = await nativeGitRunner(args, options); if (args.includes('push')) { pushes++; throw new GitError('TIMEOUT', 'Timed out after sending.'); } return result; };
    const f = await fixture({ runner }); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed'); await f.execute(await f.planCommit());
    const plan = await (await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'main' })).json() as GitPlan;
    const result = await f.execute(plan); expect(result.status).toBe('verified'); await f.execute(plan); expect(pushes).toBe(1);
  });
  it('preserves an uncertain push and reconciles later without executing it again', async () => {
    let started = false; let blocked = true; let pushes = 0;
    const runner: GitRunner = async (args, options) => {
      if (started && blocked && args.includes('ls-remote')) throw new GitError('TIMEOUT', 'Remote is temporarily unavailable.');
      const result = await nativeGitRunner(args, options);
      if (args.includes('push')) { started = true; pushes++; throw new GitError('TIMEOUT', 'Response lost.'); }
      return result;
    };
    const f = await fixture({ runner }); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Changed'); await f.execute(await f.planCommit());
    const second = createGitApp({...f.app.service.options}); await second.service.ready; second.service.session(true);
    const plan = await (await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'main' })).json() as GitPlan;
    const result = await f.execute(plan); expect(result.status).toBe('uncertain');
    expect((await second.service.operations()).operations[0].id).toBe(result.id);
    await expect(second.service.planCommit({...context, paths:['prd.md'], message:'Blocked in another process'})).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
    expect((await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'main' })).status).toBe(409);
    await f.establish(false); const untrusted = await f.request(`operations/${result.id}/reconcile`, 'POST', {});
    expect(untrusted.status).toBe(403); expect((await untrusted.json() as {error:{code:string}}).error.code).toBe('TRUST_REQUIRED');
    await f.establish(true);
    blocked = false;
    const recovered = await (await f.request(`operations/${result.id}/reconcile`, 'POST', {})).json() as GitOperation;
    expect(recovered.status).toBe('verified'); expect(pushes).toBe(1);
  });
  it('blocks a diverged remote without force, merge, rebase or any worktree alteration', async () => {
    const f = await fixture(); const remote = path.join(f.root, 'remote.git'); await git(f.root, ['init', '--bare', remote]); await git(f.repo, ['remote', 'add', 'origin', remote]); await git(f.repo, ['push', '-u', 'origin', 'main']);
    const other = path.join(f.root, 'other'); await git(f.root, ['clone', '-b', 'main', remote, other]); await git(other, ['config', 'user.name', 'Other Fixture']); await git(other, ['config', 'user.email', 'other@example.invalid']); await git(other, ['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(path.join(other, 'other.md'), 'remote changed'); await git(other, ['add', '.']); await git(other, ['commit', '-m', 'Other clone']); await git(other, ['push', 'origin', 'main']);
    await fs.writeFile(path.join(f.repo, 'prd.md'), 'Local changed'); await f.execute(await f.planCommit()); const before = await git(f.repo, ['rev-parse', 'HEAD']);
    const response = await f.request('plans/push', 'POST', { ...context, remote: 'origin', branch: 'main' });
    expect((await response.json() as { error: { code: string } }).error.code).toBe('REMOTE_DIVERGED'); expect(await git(f.repo, ['rev-parse', 'HEAD'])).toBe(before); expect(await git(f.repo, ['status', '--porcelain'])).toBe('');
  });

});
