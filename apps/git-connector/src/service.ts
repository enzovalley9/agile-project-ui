import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GitError, requireCondition, safeError } from './errors';
import { nativeGitRunner } from './runner';
import type {
  GitOptions,
  GitPlan,
  GitOperation,
  GitRepository,
  GitChange,
  MutationContext,
  ReviewFile,
  OutgoingCommit,
} from './types';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, child: string) => child === root || child.startsWith(root + path.sep);
const splitNull = (text: string) => text.split('\0').filter(Boolean);
const baseArgs = [
  '--no-replace-objects',
  '--literal-pathspecs',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'core.quotePath=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'status.submoduleSummary=false',
  '--no-pager',
];
const historyEnv = { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '' };
const MAX_FILE = 32 * 1024 * 1024;
const MAX_PATHS = 200;
const sensitivePath = (relative: string) =>
  relative
    .split('/')
    .some(
      (part) =>
        /^\.env(?:\.|$)/i.test(part) ||
        /^(secrets?|\.secrets)$/i.test(part) ||
        /\.(pem|key|p12|pfx|keystore)$/i.test(part),
    ) ||
  /(?:^|\/)\.bmad-project-ui\/local(?:\/|$)/i.test(relative) ||
  /(?:^|\/)integrations\/local(?:\/|$)/i.test(relative);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);

type Snapshot = {
  head: string | null;
  branch: string | null;
  index: string;
  config: string;
  status: string;
  files: Record<string, string>;
};
type InternalPlan = GitPlan & {
  snapshot: Snapshot;
  paths: string[];
  message?: string;
  targetSha?: string;
  targetUrl?: string;
  remoteSha?: string;
  expectedBlobs?: Record<string, string | null>;
};
type RecordEntry = { operation: GitOperation; plan: InternalPlan; repoIdentity: string };
type Challenge = { id: string; path: string; content: string; expiresAt: string };

export class GitService {
  readonly options: GitOptions;
  readonly ready: Promise<void>;
  private repo = '';
  private gitDir = '';
  private commonDir = '';
  private stateDir = '';
  private identity = '';
  private now: () => number;
  private trusted = false;
  private sessionUntil = 0;
  private binding = '';
  private challenges = new Map<string, Challenge>();
  private plans = new Map<string, InternalPlan>();
  private records = new Map<string, RecordEntry>();
  private executed = new Map<string, string>();
  private busy = false;
  private journalCorrupt = false;

  constructor(options: GitOptions) {
    requireCondition(
      options.token.length >= 32,
      'CONFIGURATION',
      'The local capability must contain at least 32 characters.',
      500,
    );
    const origin = new URL(options.origin);
    requireCondition(
      origin.origin === options.origin && ['http:', 'https:'].includes(origin.protocol),
      'CONFIGURATION',
      'Provide one exact HTTP(S) origin without a path.',
      500,
    );
    this.options = options;
    this.now = options.now ?? Date.now;
    this.ready = this.initialize();
  }

  private async initialize() {
    this.repo = await fs.realpath(this.options.repo);
    requireCondition(
      !this.options.allowMappedOwnership || !this.repo.endsWith('/*'),
      'ROOT_REQUIRED',
      'Mapped ownership requires an exact repository path without a wildcard suffix.',
    );
    const top = (await this.git(['rev-parse', '--show-toplevel'])).trim();
    requireCondition(
      (await fs.realpath(top)) === this.repo,
      'ROOT_REQUIRED',
      'Authorize the repository root, not one of its subfolders.',
    );
    this.gitDir = await fs.realpath((await this.git(['rev-parse', '--absolute-git-dir'])).trim());
    this.commonDir = await fs.realpath(
      path.resolve(this.repo, (await this.git(['rev-parse', '--git-common-dir'])).trim()),
    );
    const stat = await fs.stat(this.repo);
    this.identity = hash(
      `${this.repo}\0${stat.dev}\0${stat.ino}\0${this.gitDir}\0${this.commonDir}`,
    );
    // Preserve historical private journals; a branding change must not lose operation evidence.
    this.stateDir = path.resolve(
      this.options.stateDir ??
        path.join(os.homedir(), '.bmad-project-ui', 'git-connector', hash(this.commonDir)),
    );
    requireCondition(
      !inside(this.repo, this.stateDir) && !inside(this.commonDir, this.stateDir),
      'PRIVATE_STATE_REQUIRED',
      'Connector journals must be stored outside the repository.',
      500,
    );
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    this.stateDir = await fs.realpath(this.stateDir);
    requireCondition(
      !inside(this.repo, this.stateDir) && !inside(this.commonDir, this.stateDir),
      'PRIVATE_STATE_REQUIRED',
      'Connector journals cannot resolve into the repository.',
      500,
    );
    const stateStat = await fs.stat(this.stateDir);
    requireCondition(
      process.platform === 'win32' || (stateStat.mode & 0o077) === 0,
      'PRIVATE_STATE_REQUIRED',
      'Connector journals require a private directory accessible to the current user.',
      500,
    );
    // Desktop bind mounts can report synthetic ownership; effective permissions
    // and a private mode determine whether this process can use the directory.
    await fs.access(this.stateDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    await this.loadJournals();
  }
  private async loadJournals() {
    for (const name of await fs.readdir(this.stateDir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const journal = path.join(this.stateDir, name);
        const stat = await fs.lstat(journal);
        requireCondition(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= 2 * 1024 * 1024 &&
            (process.platform === 'win32' || (stat.mode & 0o077) === 0),
          'CORRUPT_JOURNAL',
          'A private Git journal cannot be read safely.',
        );
        const entry = JSON.parse(await fs.readFile(journal, 'utf8')) as RecordEntry;
        requireCondition(
          entry &&
            typeof entry.repoIdentity === 'string' &&
            /^[a-f0-9]{64}$/.test(entry.repoIdentity),
          'CORRUPT_JOURNAL',
          'A private Git journal has an invalid repository identity.',
        );
        if (entry.repoIdentity !== this.identity) continue;
        const { operation, plan } = entry;
        requireCondition(
          operation &&
            plan &&
            uuid(operation.id) &&
            `${operation.id}.json` === name &&
            uuid(plan.id) &&
            operation.planId === plan.id &&
            ['commit', 'branch', 'push'].includes(plan.kind) &&
            operation.kind === plan.kind &&
            ['running', 'verified', 'rejected', 'uncertain'].includes(operation.status) &&
            Number.isFinite(Date.parse(operation.startedAt)) &&
            (plan.head === null || sha(plan.head)) &&
            Array.isArray(plan.paths) &&
            plan.paths.length <= MAX_PATHS &&
            plan.paths.every(
              (file) => typeof file === 'string' && file.length > 0 && !file.includes('\0'),
            ),
          'CORRUPT_JOURNAL',
          'A private Git journal has invalid verification metadata.',
        );
        if (plan.kind === 'commit')
          requireCondition(
            typeof plan.message === 'string' &&
              plan.message.length <= 10_000 &&
              (!plan.expectedBlobs ||
                Object.values(plan.expectedBlobs).every((value) => value === null || sha(value))),
            'CORRUPT_JOURNAL',
            'A commit journal has invalid verification metadata.',
          );
        if (plan.kind === 'branch' || plan.kind === 'push')
          requireCondition(
            typeof plan.branch === 'string' &&
              plan.branch.length > 0 &&
              !plan.branch.includes('\0'),
            'CORRUPT_JOURNAL',
            'A Git journal has an invalid branch.',
          );
        if (plan.kind === 'branch')
          requireCondition(
            sha(plan.targetSha),
            'CORRUPT_JOURNAL',
            'A branch journal has an invalid target.',
          );
        if (plan.kind === 'push')
          requireCondition(
            typeof plan.targetUrl === 'string' &&
              typeof plan.remote === 'string' &&
              sha(plan.remoteSha) &&
              sha(plan.head),
            'CORRUPT_JOURNAL',
            'A push journal has invalid verification metadata.',
          );
        if (entry.operation.status === 'running') entry.operation.status = 'uncertain';
        this.records.set(entry.operation.id, entry);
        this.executed.set(entry.plan.id, entry.operation.id);
      } catch {
        this.journalCorrupt = true; /* Preserve evidence and block mutation, but keep reading available. */
      }
    }
  }

  private gitArguments(args: string[]) {
    // Docker Desktop may map a bind mount to another numeric owner. This explicit
    // opt-in trusts only the canonical configured root, for this command alone.
    const ownership = this.options.allowMappedOwnership
      ? ['-c', `safe.directory=${this.repo}`]
      : [];
    return [...baseArgs, ...ownership, ...args];
  }
  private gitEnvironment(env?: Record<string, string>) {
    return {
      ...env,
      ...historyEnv,
      // Enforce the supported transports after URL rewrites and during redirects.
      // The local transport is available only to explicitly configured test fixtures.
      GIT_ALLOW_PROTOCOL: this.options.allowLocalRemotes ? 'https:ssh:file' : 'https:ssh',
    };
  }
  private async git(args: string[], allowFailure = false, env?: Record<string, string>) {
    const result = await (this.options.runner ?? nativeGitRunner)(this.gitArguments(args), {
      cwd: this.repo || path.resolve(this.options.repo),
      timeoutMs: this.options.commandTimeoutMs ?? 30_000,
      env: this.gitEnvironment(env),
    });
    if (result.exitCode !== 0 && !allowFailure) {
      const code =
        /Authentication failed|could not read Username|Permission denied|publickey|terminal prompts disabled/i.test(
          result.stderr,
        )
          ? 'AUTHENTICATION'
          : /index\.lock|cannot lock ref|another git process/i.test(result.stderr)
            ? 'GIT_LOCKED'
            : /non-fast-forward|fetch first|rejected/i.test(result.stderr)
              ? 'PUSH_REJECTED'
              : /dubious ownership/i.test(result.stderr)
                ? 'UNTRUSTED_OWNERSHIP'
                : 'GIT_FAILED';
      throw new GitError(
        code,
        code === 'AUTHENTICATION'
          ? 'Native Git authentication needs attention. Configure credentials in your Git client.'
          : code === 'GIT_LOCKED'
            ? 'Git has an active lock. Resolve it with your Git client; this connector will not remove it.'
            : code === 'PUSH_REJECTED'
              ? 'The remote rejected this push. Keep your local commits and integrate changes with your Git client.'
              : 'Git rejected this operation. Inspect its hooks, signing, permissions or repository state with your Git client.',
      );
    }
    return result.stdout;
  }

  private async assertIdentity() {
    const real = await fs.realpath(this.options.repo);
    const stat = await fs.stat(real);
    const gitDir = await fs.realpath((await this.git(['rev-parse', '--absolute-git-dir'])).trim());
    const common = await fs.realpath(
      path.resolve(this.repo, (await this.git(['rev-parse', '--git-common-dir'])).trim()),
    );
    requireCondition(
      hash(`${real}\0${stat.dev}\0${stat.ino}\0${gitDir}\0${common}`) === this.identity,
      'REPOSITORY_CHANGED',
      'The authorized repository was replaced or moved. Reconnect to verify it.',
    );
  }

  session(trustRepository: boolean) {
    this.trusted = trustRepository;
    this.sessionUntil = this.now() + 8 * 60 * 60 * 1000;
    this.binding = '';
    this.plans.clear();
    this.challenges.clear();
    return {
      protocol: 1,
      trusted: this.trusted,
      expiresAt: new Date(this.sessionUntil).toISOString(),
      bindingRequired: true,
    };
  }
  disconnect() {
    this.trusted = false;
    this.sessionUntil = 0;
    this.binding = '';
    this.plans.clear();
    this.challenges.clear();
  }
  assertSession() {
    requireCondition(
      this.sessionUntil > this.now(),
      'SESSION_REQUIRED',
      'Connect the Git session again.',
      401,
    );
  }
  assertBinding(binding: string | undefined) {
    this.assertSession();
    requireCondition(
      this.binding && binding === this.binding,
      'BINDING_REQUIRED',
      'Verify that the browser folder is the authorized Git repository.',
      403,
    );
  }
  async challenge(): Promise<Challenge> {
    await this.ready;
    this.assertSession();
    await this.assertIdentity();
    const id = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const result = {
      id,
      path: `.bmad-project-ui/local/git-bindings/${id}.json`,
      content: JSON.stringify({ version: 1, id, nonce }),
      expiresAt: new Date(this.now() + 120_000).toISOString(),
    };
    this.challenges.clear();
    this.challenges.set(id, result);
    return result;
  }
  async verifyBinding(id: string) {
    await this.ready;
    this.assertSession();
    await this.assertIdentity();
    const challenge = this.challenges.get(id);
    requireCondition(
      challenge && Date.parse(challenge.expiresAt) > this.now(),
      'CHALLENGE_EXPIRED',
      'Request a new project verification challenge.',
    );
    const file = await this.securePath(challenge.path);
    requireCondition(
      (await fs.stat(file)).size === Buffer.byteLength(challenge.content),
      'BINDING_MISMATCH',
      'The browser folder does not match the authorized Git repository.',
      403,
    );
    requireCondition(
      (await fs.readFile(file, 'utf8')) === challenge.content,
      'BINDING_MISMATCH',
      'The browser folder does not match the authorized Git repository.',
      403,
    );
    this.challenges.delete(id);
    this.binding = randomUUID();
    this.plans.clear();
    return {
      bindingId: this.binding,
      rootName: path.basename(this.repo),
      removePath: challenge.path,
    };
  }

  private async securePath(relative: string, allowMissing = false): Promise<string> {
    requireCondition(
      relative.length > 0 &&
        relative.length < 2048 &&
        !relative.includes('\0') &&
        !relative.includes('\\') &&
        !path.isAbsolute(relative),
      'INVALID_PATH',
      'Only safe relative repository paths are allowed.',
      400,
    );
    const parts = relative.split('/');
    requireCondition(
      parts.every(
        (part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git',
      ),
      'INVALID_PATH',
      'The path is outside the permitted project content.',
      400,
    );
    let cursor = this.repo;
    for (let i = 0; i < parts.length; i++) {
      cursor = path.join(cursor, parts[i]);
      let stat;
      try {
        stat = await fs.lstat(cursor);
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT')
          return path.join(this.repo, ...parts);
        throw new GitError(
          'FILE_MISSING',
          'A reviewed file no longer exists. Refresh the project.',
        );
      }
      requireCondition(
        !stat.isSymbolicLink(),
        'SYMLINK_REJECTED',
        'Symbolic links are not admitted in reviewed paths.',
        403,
      );
      if (i < parts.length - 1)
        requireCondition(
          stat.isDirectory(),
          'INVALID_PATH',
          'A parent component is not a directory.',
          400,
        );
      else
        requireCondition(
          stat.isFile(),
          'REGULAR_FILE_REQUIRED',
          'Only regular files can be reviewed.',
          400,
        );
    }
    return cursor;
  }
  private async contentHash(relative: string) {
    const file = await this.securePath(relative, true);
    try {
      const stat = await fs.stat(file);
      requireCondition(
        stat.size <= MAX_FILE,
        'FILE_TOO_LARGE',
        'This file exceeds the 32 MiB review limit.',
      );
      return hash(await fs.readFile(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'deleted';
      throw error;
    }
  }
  private async head() {
    return (await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim() || null;
  }
  private async branch() {
    return (await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], true)).trim() || null;
  }
  private async rawStatus() {
    if (!this.trusted)
      requireCondition(
        !(
          await this.git(['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], true)
        ).trim(),
        'TRUST_REQUIRED',
        'This repository configures executable content filters. Trust it explicitly before querying native Git status.',
        403,
      );
    return this.git([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=all',
    ]);
  }
  private parseStatus(raw: string): GitChange[] {
    const entries = raw.split('\0');
    const result: GitChange[] = [];
    for (let i = 0; i < entries.length; i++) {
      const record = entries[i];
      if (!record) continue;
      const change: GitChange = { index: record[0], workingTree: record[1], path: record.slice(3) };
      if ('RC'.includes(change.index) || 'RC'.includes(change.workingTree))
        change.originalPath = entries[++i];
      result.push(change);
    }
    return result;
  }
  private async pendingGit() {
    const names = [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
      'sequencer',
      'index.lock',
    ];
    const result: string[] = [];
    for (const name of names)
      try {
        await fs.access(path.join(this.gitDir, name));
        result.push(name);
      } catch {
        /* Absent marker. */
      }
    return result;
  }
  private sanitizeUrl(input: string): string {
    // A remote is untrusted configuration. Hide all URL userinfo and query/fragment
    // content even when its protocol is not eligible for a push.
    return input
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
      .replace(/[?#].*$/, '[redacted]');
  }
  private async remotes() {
    const names = (await this.git(['remote'])).split('\n').filter(Boolean);
    const result = [];
    for (const name of names) {
      const urls = (await this.git(['remote', 'get-url', '--push', '--all', name], true))
        .trim()
        .split('\n')
        .filter(Boolean);
      result.push({ name, url: urls.map((url) => this.sanitizeUrl(url)).join(', ') });
    }
    return result;
  }
  async repository(): Promise<GitRepository> {
    await this.ready;
    await this.assertIdentity();
    const changes = this.parseStatus(await this.rawStatus());
    return {
      rootName: path.basename(this.repo),
      branch: await this.branch(),
      head: await this.head(),
      changes,
      conflicts: changes
        .filter(
          (entry) =>
            entry.index === 'U' ||
            entry.workingTree === 'U' ||
            ['AA', 'DD'].includes(entry.index + entry.workingTree),
        )
        .map((entry) => entry.path),
      staged: changes
        .filter((entry) => entry.index !== ' ' && entry.index !== '?')
        .map((entry) => entry.path),
      dirty: changes.length > 0,
      remotes: await this.remotes(),
      operationInProgress: await this.pendingGit(),
      trusted: this.trusted,
    };
  }
  async branches() {
    await this.ready;
    await this.assertIdentity();
    const raw = await this.git([
      'for-each-ref',
      '--format=%(refname:short)%00%(HEAD)%00%(worktreepath)',
      'refs/heads/',
    ]);
    return {
      branches: raw
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map((row) => {
          const [name, current, worktree] = row.split('\0');
          return {
            name,
            current: current === '*',
            ...(worktree ? { worktree: path.basename(worktree) } : {}),
          };
        }),
    };
  }
  private validateContext(context: MutationContext, kind: string) {
    requireCondition(
      context &&
        Number.isInteger(context.drafts) &&
        typeof context.saving === 'boolean' &&
        typeof context.recoveryPending === 'boolean',
      'CONTEXT_REQUIRED',
      'Provide the current draft, save and recovery state.',
      400,
    );
    requireCondition(
      !context.saving && !context.recoveryPending,
      'SAVE_IN_PROGRESS',
      'Complete or recover pending saves before using Git.',
    );
    if (kind !== 'push')
      requireCondition(
        context.drafts === 0,
        'UNSAVED_DRAFTS',
        'Save or preserve pending drafts before this Git operation.',
      );
    requireCondition(context.drafts >= 0, 'INVALID_CONTEXT', 'The draft count is invalid.', 400);
  }
  private async mutationGate(kind: string, context: MutationContext) {
    await this.ready;
    this.assertSession();
    this.validateContext(context, kind);
    await this.assertIdentity();
    requireCondition(
      this.trusted,
      'TRUST_REQUIRED',
      'Explicitly trust this repository before running hooks, filters, signing and native credential helpers.',
      403,
    );
    requireCondition(!this.busy, 'BUSY', 'Another Git operation is in progress.');
    await this.loadJournals();
    requireCondition(
      !this.journalCorrupt,
      'CORRUPT_JOURNAL',
      'A private Git recovery journal is unreadable. Inspect it before starting another mutation.',
    );
    requireCondition(
      ![...this.records.values()].some(
        (entry) => entry.operation.status === 'running' || entry.operation.status === 'uncertain',
      ),
      'RECOVERY_REQUIRED',
      'Reconcile the pending Git operation before starting another mutation.',
    );
    const repository = await this.repository();
    requireCondition(
      !repository.conflicts.length && !repository.operationInProgress.length,
      'GIT_CONFLICT',
      'Git has a lock or unfinished integration. Resolve it externally before continuing.',
    );
    requireCondition(
      repository.branch !== null,
      'DETACHED_HEAD',
      'Select a local branch with your Git client before making changes.',
    );
    return repository;
  }
  private async snapshot(paths: string[]): Promise<Snapshot> {
    const indexPath = path.join(this.gitDir, 'index');
    let index = 'absent';
    try {
      index = hash(await fs.readFile(indexPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const files: Record<string, string> = {};
    for (const file of paths) files[file] = await this.contentHash(file);
    return {
      head: await this.head(),
      branch: await this.branch(),
      index,
      config: hash(await this.git(['config', '--null', '--list'])),
      status: await this.rawStatus(),
      files,
    };
  }
  private publicPlan(plan: InternalPlan): GitPlan {
    const { id, kind, expiresAt, summary, head, files, commits, remote, branch, remoteUrl } = plan;
    return {
      id,
      kind,
      expiresAt,
      summary,
      head,
      files,
      ...(commits ? { commits } : {}),
      ...(remote ? { remote } : {}),
      ...(branch ? { branch } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
    };
  }
  private storePlan(plan: Omit<InternalPlan, 'id' | 'expiresAt'>) {
    const stored = {
      ...plan,
      id: randomUUID(),
      expiresAt: new Date(this.now() + (this.options.planTtlMs ?? 300_000)).toISOString(),
    };
    this.plans.set(stored.id, stored);
    return this.publicPlan(stored);
  }
  async planCommit(input: MutationContext & { paths: string[]; message: string }) {
    const repository = await this.mutationGate('commit', input);
    requireCondition(
      repository.staged.length === 0,
      'FOREIGN_INDEX',
      'The index already contains staged changes. Commit or unstage them with your Git client first.',
    );
    requireCondition(
      Array.isArray(input.paths) &&
        input.paths.length > 0 &&
        input.paths.length <= MAX_PATHS &&
        input.paths.every((item) => typeof item === 'string'),
      'INVALID_PATHS',
      'Select between 1 and 200 changed files.',
      400,
    );
    requireCondition(
      typeof input.message === 'string' &&
        input.message.trim().length > 0 &&
        input.message.length <= 10_000 &&
        !input.message.includes('\0'),
      'INVALID_MESSAGE',
      'Enter a commit message of at most 10,000 characters.',
      400,
    );
    const paths = [...new Set(input.paths)].sort();
    requireCondition(
      paths.length === input.paths.length,
      'DUPLICATE_PATH',
      'Select each file once.',
      400,
    );
    for (const file of paths)
      requireCondition(
        !sensitivePath(file),
        'PRIVATE_FILE',
        'Secret files, local recovery data and integration journals cannot be reviewed or committed through this connector.',
        403,
      );
    const reviewedSnapshot = await this.snapshot(paths);
    requireCondition(
      reviewedSnapshot.head === repository.head &&
        reviewedSnapshot.branch === repository.branch &&
        JSON.stringify(this.parseStatus(reviewedSnapshot.status)) ===
          JSON.stringify(repository.changes),
      'STALE_PLAN',
      'The repository changed while preparing this review. Refresh and review again.',
    );
    const files: ReviewFile[] = [];
    for (const file of paths) {
      requireCondition(
        !sensitivePath(file),
        'PRIVATE_FILE',
        'Secret files, local recovery data and integration journals cannot be reviewed or committed through this connector.',
        403,
      );
      await this.securePath(file, true);
      const change = repository.changes.find((entry) => entry.path === file);
      requireCondition(
        change,
        'NO_CHANGE',
        'A selected file has no current change. Refresh the review.',
      );
      if (change.index === '?')
        requireCondition(
          (await fs.stat(path.join(this.repo, file))).size <= MAX_FILE,
          'FILE_TOO_LARGE',
          'This file exceeds the 32 MiB review limit.',
        );
      let diff: string;
      if (change.index === '?') {
        const bytes = await fs.readFile(path.join(this.repo, file));
        try {
          diff = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          throw new GitError(
            'UNREVIEWABLE_FILE',
            'An untracked file is not valid UTF-8 text. Review it with your native Git client.',
          );
        }
        requireCondition(
          !diff.includes('\0'),
          'UNREVIEWABLE_FILE',
          'An untracked file contains binary data. Review it with your native Git client.',
        );
      } else
        diff = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--', file]);
      requireCondition(
        Buffer.byteLength(diff) <= 2 * 1024 * 1024,
        'DIFF_TOO_LARGE',
        'A selected diff exceeds the review limit.',
      );
      files.push({ path: file, status: change.index + change.workingTree, diff });
      requireCondition(
        Buffer.byteLength(JSON.stringify(files)) <= 4 * 1024 * 1024,
        'REVIEW_TOO_LARGE',
        'This review exceeds 4 MiB. Select a smaller set of changes.',
      );
    }
    requireCondition(
      JSON.stringify(await this.snapshot(paths)) === JSON.stringify(reviewedSnapshot),
      'STALE_PLAN',
      'The repository changed while rendering the review. Refresh and review again.',
    );
    return this.storePlan({
      kind: 'commit',
      summary: input.message.trim(),
      head: repository.head,
      paths,
      message: input.message.trim(),
      files,
      snapshot: reviewedSnapshot,
    });
  }
  async planBranch(input: MutationContext & { branch: string }) {
    const repository = await this.mutationGate('branch', input);
    requireCondition(
      !repository.dirty,
      'DIRTY_WORKTREE',
      'The worktree must be clean before switching branches. No changes will be stashed or discarded.',
    );
    const branches = (await this.branches()).branches;
    const branch = branches.find((entry) => entry.name === input.branch);
    requireCondition(
      branch && !branch.current,
      'INVALID_BRANCH',
      'Choose an existing local branch different from the current branch.',
      400,
    );
    requireCondition(
      !branch.worktree,
      'BRANCH_IN_USE',
      'This branch is checked out in another worktree.',
    );
    const targetSha = (
      await this.git(['rev-parse', '--verify', `refs/heads/${branch.name}`])
    ).trim();
    return this.storePlan({
      kind: 'branch',
      summary: `Switch to ${branch.name}`,
      head: repository.head,
      paths: [],
      files: [],
      branch: branch.name,
      targetSha,
      snapshot: await this.snapshot([]),
    });
  }
  private async remoteTarget(remote: string) {
    requireCondition(
      typeof remote === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) &&
        !remote.includes('..'),
      'INVALID_REMOTE',
      'Choose a configured Git remote.',
      400,
    );
    const names = (await this.git(['remote'])).split('\n');
    requireCondition(
      names.includes(remote),
      'INVALID_REMOTE',
      'The selected remote is not configured.',
      400,
    );
    const urls = (await this.git(['remote', 'get-url', '--push', '--all', remote]))
      .trim()
      .split('\n')
      .filter(Boolean);
    requireCondition(
      urls.length === 1,
      'MULTIPLE_TARGETS',
      'A push must have exactly one effective destination. Configure it with your Git client.',
    );
    const url = urls[0];
    const https = /^https:\/\//.test(url);
    const ssh = /^ssh:\/\//.test(url) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(url);
    const local =
      this.options.allowLocalRemotes && (path.isAbsolute(url) || url.startsWith('file://'));
    requireCondition(
      https || ssh || local,
      'REMOTE_PROTOCOL',
      'This connector supports HTTPS and SSH Git remotes.',
      403,
    );
    requireCondition(
      !url.includes('\n') && !url.includes('\0'),
      'INVALID_REMOTE',
      'The remote destination is invalid.',
      400,
    );
    if (https || url.startsWith('ssh://')) {
      const parsed = new URL(url);
      requireCondition(
        (!https || !parsed.username) && !parsed.password && !parsed.search && !parsed.hash,
        'EMBEDDED_CREDENTIALS',
        'Use native Git credential helpers instead of credentials or query parameters in the remote URL.',
        403,
      );
    }
    if (ssh)
      requireCondition(
        !/[?#]/.test(url),
        'EMBEDDED_CREDENTIALS',
        'SSH remote destinations cannot contain query or fragment data.',
        403,
      );
    // get-url has already expanded native rewrite rules. Feeding that URL back to
    // Git must not apply a second rewrite to a destination absent from the review.
    const transportUrl = (await this.git(['ls-remote', '--get-url', '--', url])).trim();
    // get-url requires a repository-defined remote, so an ephemeral -c remote is
    // insufficient as a probe. Any push alias still matching this already-expanded
    // URL would be applied again when push receives the explicit URL as its target.
    const pushRules = splitNull(
      await this.git(['config', '--null', '--get-regexp', '^url\\..*\\.pushinsteadof$'], true),
    );
    const rewrittenPush = pushRules.some((rule) => {
      const separator = rule.indexOf('\n');
      return separator >= 0 && url.startsWith(rule.slice(separator + 1));
    });
    requireCondition(
      transportUrl === url && !rewrittenPush,
      'REMOTE_REWRITE',
      'The effective destination is rewritten again by Git configuration. Use an unambiguous remote URL before reviewing a push.',
    );
    return url;
  }
  private async remoteSha(url: string, branch: string) {
    const ref = `refs/heads/${branch}`;
    const raw = await this.git(['ls-remote', '--refs', '--', url, ref]);
    const matching = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
      .filter(([, name]) => name === ref);
    requireCondition(
      matching.length === 1 && /^[a-f0-9]{40,64}$/.test(matching[0][0]),
      'REMOTE_BRANCH_MISSING',
      'Choose an existing remote branch. Branch creation is outside this connector.',
    );
    return matching[0][0];
  }
  private async historyFiles(sha: string): Promise<ReviewFile[]> {
    const names = splitNull(
      await this.git([
        'diff-tree',
        '--root',
        '--first-parent',
        '--diff-merges=first-parent',
        '--no-commit-id',
        '--name-only',
        '-r',
        '-z',
        sha,
      ]),
    );
    requireCondition(
      names.length <= MAX_PATHS,
      'HISTORY_TOO_LARGE',
      'A commit exceeds the per-review file limit. Use your Git client.',
    );
    requireCondition(
      !names.some(sensitivePath),
      'PRIVATE_FILE',
      'Outgoing history contains secret paths or local connector data. Inspect and resolve it with your native Git client before pushing.',
      403,
    );
    const files: ReviewFile[] = [];
    for (const file of names) {
      files.push({
        path: file,
        status: 'committed',
        diff: await this.git([
          'show',
          '--format=',
          '--first-parent',
          '--diff-merges=first-parent',
          '--no-ext-diff',
          '--no-textconv',
          '--binary',
          sha,
          '--',
          file,
        ]),
      });
      requireCondition(
        Buffer.byteLength(JSON.stringify(files)) <= 4 * 1024 * 1024,
        'REVIEW_TOO_LARGE',
        'This commit review exceeds 4 MiB. Use your Git client.',
      );
    }
    return files;
  }
  async planPush(input: MutationContext & { remote: string; branch: string }) {
    const repository = await this.mutationGate('push', input);
    requireCondition(repository.head, 'NO_COMMITS', 'Create a local commit before pushing.');
    requireCondition(
      typeof input.branch === 'string' && input.branch.length > 0,
      'INVALID_BRANCH',
      'Select an existing remote branch.',
      400,
    );
    await this.git(['check-ref-format', `refs/heads/${input.branch}`]);
    const targetUrl = await this.remoteTarget(input.remote);
    const remoteSha = await this.remoteSha(targetUrl, input.branch);
    const ancestry = await (this.options.runner ?? nativeGitRunner)(
      this.gitArguments(['merge-base', '--is-ancestor', remoteSha, repository.head]),
      {
        cwd: this.repo,
        timeoutMs: this.options.commandTimeoutMs ?? 30_000,
        env: this.gitEnvironment(),
      },
    );
    requireCondition(
      ancestry.exitCode === 0,
      'REMOTE_DIVERGED',
      'The remote tip is missing locally or is not an ancestor. Fetch and integrate with your Git client before reviewing again.',
    );
    const raw = await this.git(['log', '--format=%H%x00%s', `${remoteSha}..${repository.head}`]);
    const lines = raw.trimEnd().split('\n').filter(Boolean);
    requireCondition(
      lines.length > 0,
      'NOTHING_TO_PUSH',
      'The selected remote already contains this tip.',
    );
    requireCondition(
      lines.length <= 100,
      'HISTORY_TOO_LARGE',
      'This push has more than 100 outgoing commits. Review it with your Git client.',
    );
    const commits: OutgoingCommit[] = [];
    for (const row of lines) {
      const [sha, subject] = row.split('\0');
      commits.push({ sha, subject, files: await this.historyFiles(sha) });
      requireCondition(
        Buffer.byteLength(JSON.stringify(commits)) <= 4 * 1024 * 1024,
        'REVIEW_TOO_LARGE',
        'This outgoing history exceeds 4 MiB. Use your Git client.',
      );
    }
    return this.storePlan({
      kind: 'push',
      summary: `Push ${commits.length} commits to ${input.remote}/${input.branch}`,
      head: repository.head,
      paths: [],
      files: commits.flatMap((commit) => commit.files),
      commits,
      remote: input.remote,
      branch: input.branch,
      remoteUrl: this.sanitizeUrl(targetUrl),
      targetUrl,
      remoteSha,
      snapshot: await this.snapshot([]),
    });
  }

  private async persist(entry: RecordEntry) {
    const file = path.join(this.stateDir, `${entry.operation.id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    // Keep only verification metadata in private journals, never reviewed document diffs.
    const plan = {
      ...entry.plan,
      files: [],
      commits: entry.plan.commits?.map((commit) => ({ ...commit, files: [] })),
    };
    await fs.writeFile(temporary, JSON.stringify({ ...entry, plan }), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  }
  private async verifyCommit(plan: InternalPlan, sha: string | null) {
    if (!sha || sha === plan.head) return false;
    const parent = (await this.git(['rev-parse', '--verify', `${sha}^`], true)).trim() || null;
    if (parent !== plan.head) return false;
    const message = (await this.git(['show', '-s', '--format=%B', sha])).trim();
    if (message !== plan.message) return false;
    const changed = splitNull(
      await this.git([
        'diff-tree',
        '--root',
        '--first-parent',
        '--diff-merges=first-parent',
        '--no-commit-id',
        '--name-only',
        '-r',
        '-z',
        sha,
      ]),
    );
    if (changed.some((file) => !plan.paths.includes(file)) || !changed.length) return false;
    for (const file of plan.paths) {
      const actual =
        (await this.git(['rev-parse', '--verify', `${sha}:${file}`], true)).trim() || null;
      if (actual !== plan.expectedBlobs?.[file]) return false;
    }
    return true;
  }
  private async commitReviewed(entry: RecordEntry) {
    const { plan, operation } = entry;
    const indexPath = path.join(this.gitDir, 'index'),
      lockPath = `${indexPath}.lock`;
    const privateIndex = path.join(this.stateDir, `${operation.id}.index`);
    let indexLock;
    try {
      indexLock = await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new GitError(
          'GIT_LOCKED',
          'The native Git index is locked. Its existing lock has been preserved.',
        );
      throw error;
    }
    let ownLock = true,
      published = false;
    const env = { GIT_INDEX_FILE: privateIndex };
    try {
      // The owned native lock prevents another Git process from staging into the
      // real index while this isolated copy is committed. Never use --only: that
      // option recaptures mutable working-tree bytes after the final review check.
      requireCondition(
        JSON.stringify(await this.snapshot(plan.paths)) === JSON.stringify(plan.snapshot),
        'STALE_PLAN',
        'The repository changed before its index was locked. Review again.',
      );
      try {
        const originalIndex = await fs.stat(indexPath);
        await fs.copyFile(indexPath, privateIndex, fs.constants.COPYFILE_EXCL);
        // Copying bytes with a newer mtime can make racy entries look clean to
        // Git. Keep its rehash threshold at or before the original timestamp;
        // whole seconds avoid rounding a nanosecond timestamp forward.
        await fs.utimes(
          privateIndex,
          originalIndex.atime,
          Math.floor(originalIndex.mtimeMs / 1000),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.git(['read-tree', '--empty'], false, env);
      }
      await fs.chmod(privateIndex, 0o600);
      await this.git(['add', '--', ...plan.paths], false, env);
      const staged = splitNull(
        await this.git(['diff', '--cached', '--name-only', '--no-renames', '-z'], false, env),
      );
      requireCondition(
        staged.every((file) => plan.paths.includes(file)),
        'FOREIGN_INDEX',
        'The isolated index contains unreviewed paths. No commit has been created.',
      );
      for (const file of plan.paths)
        requireCondition(
          (await this.contentHash(file)) === plan.snapshot.files[file],
          'STALE_PLAN',
          'A selected file changed while staging. No commit has been created.',
        );
      plan.expectedBlobs = {};
      for (const file of plan.paths)
        plan.expectedBlobs[file] =
          (await this.git(['rev-parse', '--verify', `:${file}`], true, env)).trim() || null;
      await this.persist(entry);
      try {
        await this.git(['commit', '-m', plan.message!], false, env);
      } finally {
        if (await this.verifyCommit(plan, await this.head())) {
          let currentIndex = 'absent';
          try {
            currentIndex = hash(await fs.readFile(indexPath));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          requireCondition(
            currentIndex === plan.snapshot.index,
            'FOREIGN_INDEX',
            'A program changed the real index despite its lock. Its contents were preserved; inspect the verified commit and index with Git.',
          );
          const committedIndex = await fs.stat(privateIndex);
          await indexLock.writeFile(await fs.readFile(privateIndex));
          await indexLock.utimes(committedIndex.atime, Math.floor(committedIndex.mtimeMs / 1000));
          await indexLock.sync();
          await indexLock.close();
          await fs.rename(lockPath, indexPath);
          ownLock = false;
          published = true;
        }
      }
    } finally {
      await indexLock.close();
      if (ownLock) await fs.unlink(lockPath); // Only the lock created above, never an existing native lock.
      if (published) await fs.unlink(privateIndex);
      // Preserve an unverified private index as recovery evidence; it is not an
      // executable plan, and neither it nor its contents are returned to the web.
    }
  }
  async execute(planId: string, context: MutationContext): Promise<GitOperation> {
    await this.ready;
    this.assertSession();
    const existing = this.executed.get(planId);
    if (existing) return this.records.get(existing)!.operation;
    const plan = this.plans.get(planId);
    requireCondition(
      plan && Date.parse(plan.expiresAt) > this.now(),
      'PLAN_EXPIRED',
      'This review expired. Prepare a new plan.',
    );
    await this.mutationGate(plan.kind, context);
    const fresh = await this.snapshot(plan.paths);
    // Push only publishes committed history; saved/untracked files may change independently.
    if (plan.kind === 'push') {
      fresh.status = plan.snapshot.status;
      fresh.index = plan.snapshot.index;
    }
    requireCondition(
      JSON.stringify(fresh) === JSON.stringify(plan.snapshot),
      'STALE_PLAN',
      'The repository changed after review. Prepare a new plan.',
    );
    if (plan.kind === 'branch')
      requireCondition(
        (await this.git(['rev-parse', '--verify', `refs/heads/${plan.branch}`])).trim() ===
          plan.targetSha,
        'STALE_PLAN',
        'The target branch moved after review.',
      );
    if (plan.kind === 'push')
      requireCondition(
        (await this.remoteTarget(plan.remote!)) === plan.targetUrl &&
          (await this.remoteSha(plan.targetUrl!, plan.branch!)) === plan.remoteSha,
        'STALE_PLAN',
        'The remote destination or tip changed after review.',
      );
    const operation: GitOperation = {
      id: randomUUID(),
      planId,
      kind: plan.kind,
      status: 'running',
      startedAt: new Date(this.now()).toISOString(),
    };
    const entry: RecordEntry = { operation, plan, repoIdentity: this.identity };
    const lockPath = path.join(this.stateDir, 'operation.lock');
    let lock;
    try {
      lock = await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new GitError(
          'BUSY',
          'Another connector process holds the operation lock. Inspect it before continuing.',
        );
      throw error;
    }
    let started = false,
      registered = false;
    try {
      // Another connector may have finished since this process last observed its
      // journals. Recheck under the shared lock before recording or mutating.
      await this.loadJournals();
      requireCondition(
        !this.journalCorrupt,
        'CORRUPT_JOURNAL',
        'A private Git recovery journal is unreadable. Inspect it before starting another mutation.',
      );
      const duplicate = this.executed.get(planId);
      if (duplicate) return this.records.get(duplicate)!.operation;
      requireCondition(
        ![...this.records.values()].some((record) =>
          ['running', 'uncertain'].includes(record.operation.status),
        ),
        'RECOVERY_REQUIRED',
        'Reconcile the pending Git operation before starting another mutation.',
      );
      this.busy = true;
      this.records.set(operation.id, entry);
      this.executed.set(planId, operation.id);
      registered = true;
      await lock.writeFile(JSON.stringify({ pid: process.pid, operationId: operation.id }));
      await this.persist(entry);
      await this.assertIdentity();
      const finalSnapshot = await this.snapshot(plan.paths);
      if (plan.kind === 'push') {
        finalSnapshot.status = plan.snapshot.status;
        finalSnapshot.index = plan.snapshot.index;
      }
      requireCondition(
        JSON.stringify(finalSnapshot) === JSON.stringify(plan.snapshot),
        'STALE_PLAN',
        'The repository changed while preparing this operation.',
      );
      if (plan.kind === 'commit') {
        started = true;
        await this.commitReviewed(entry);
      } else if (plan.kind === 'branch') {
        started = true;
        await this.git(['switch', '--no-guess', '--', plan.branch!]);
      } else {
        started = true;
        await this.git([
          '-c',
          'push.followTags=false',
          'push',
          '--porcelain',
          '--no-force',
          '--no-follow-tags',
          '--recurse-submodules=no',
          '--',
          plan.targetUrl!,
          `${plan.head}:refs/heads/${plan.branch}`,
        ]);
      }
      await this.observe(entry);
    } catch (error) {
      if (!registered) throw error;
      operation.error = safeError(error);
      operation.status = started ? 'uncertain' : 'rejected';
      if (started) {
        try {
          await this.observe(entry);
        } catch {
          operation.status = 'uncertain';
        }
        // A command with definitive rejection and unchanged local/remote state did not succeed.
        if (
          operation.status === 'uncertain' &&
          error instanceof GitError &&
          !['TIMEOUT', 'OUTPUT_LIMIT'].includes(error.code)
        ) {
          if (plan.kind !== 'push' && (await this.head()) === plan.head)
            operation.status = 'rejected';
          if (
            plan.kind === 'push' &&
            ['PUSH_REJECTED', 'AUTHENTICATION', 'REMOTE_DIVERGED'].includes(error.code)
          )
            operation.status = 'rejected';
        }
      }
    } finally {
      if (registered) {
        operation.completedAt = new Date(this.now()).toISOString();
        try {
          await this.persist(entry);
        } catch {
          operation.status = 'uncertain';
          operation.error = {
            code: 'JOURNAL_FAILED',
            message:
              'Git may have completed, but its result could not be persisted. Reconcile before trying again.',
          };
        }
      }
      this.busy = false;
      await lock.close();
      await fs.unlink(lockPath);
    }
    return operation;
  }
  private async observe(entry: RecordEntry) {
    const { plan, operation } = entry;
    await this.assertIdentity();
    if (plan.kind === 'push') {
      const actual = await this.remoteSha(plan.targetUrl!, plan.branch!);
      operation.remoteSha = actual;
      if (actual === plan.head) operation.status = 'verified';
      else {
        const result = await (this.options.runner ?? nativeGitRunner)(
          this.gitArguments(['merge-base', '--is-ancestor', plan.head!, actual]),
          { cwd: this.repo, timeoutMs: 30_000, env: this.gitEnvironment() },
        );
        operation.status = result.exitCode === 0 ? 'verified' : 'uncertain';
      }
    } else {
      const head = await this.head();
      if (head) operation.head = head;
      operation.status =
        plan.kind === 'commit'
          ? (await this.verifyCommit(plan, head))
            ? 'verified'
            : 'uncertain'
          : head === plan.targetSha && (await this.branch()) === plan.branch
            ? 'verified'
            : 'uncertain';
    }
    if (operation.status === 'verified' && operation.error) {
      operation.warning =
        'Git reported an error, but its intended result was independently observed. Inspect hooks and local state.';
      delete operation.error;
    }
  }
  async operations() {
    await this.ready;
    if (!this.busy) await this.loadJournals();
    const sorted = [...this.records.values()]
      .map((entry) => entry.operation)
      .sort((left, right) => {
        const pending = (item: GitOperation) =>
          item.status === 'running' || item.status === 'uncertain' ? 1 : 0;
        return (
          pending(right) - pending(left) || Date.parse(right.startedAt) - Date.parse(left.startedAt)
        );
      });
    // An unresolved operation prevents new mutations, so it cannot be displaced by
    // later successful work. Returning public records exposes no private paths/data.
    return { operations: sorted.slice(0, 20), hasMore: sorted.length > 20 };
  }
  async operationByPlan(planId: string) {
    await this.ready;
    if (!this.busy) await this.loadJournals();
    const id = this.executed.get(planId);
    requireCondition(
      id,
      'OPERATION_NOT_FOUND',
      'No operation is recorded for this reviewed plan.',
      404,
    );
    return this.records.get(id)!.operation;
  }
  private async releaseDeadOperationLock(operationId: string) {
    const file = path.join(this.stateDir, 'operation.lock');
    try {
      const original = await fs.readFile(file, 'utf8');
      const record = JSON.parse(original) as { pid: number; operationId: string };
      if (!Number.isInteger(record.pid) || record.pid <= 0 || record.operationId !== operationId)
        return;
      try {
        process.kill(record.pid, 0);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return;
      }
      // This is our private connector lock, never a Git index/ref lock. Only recover
      // the same recorded operation after proving the owner process no longer exists.
      if ((await fs.readFile(file, 'utf8')) === original) await fs.unlink(file);
    } catch {
      /* Never remove an unknown or unverifiable lock. */
    }
  }
  async operation(id: string) {
    await this.ready;
    if (!this.busy) await this.loadJournals();
    const entry = this.records.get(id);
    requireCondition(
      entry,
      'OPERATION_NOT_FOUND',
      'This operation is not recorded for the authorized repository.',
      404,
    );
    return entry.operation;
  }
  async reconcile(id: string) {
    await this.ready;
    if (!this.busy) await this.loadJournals();
    const entry = this.records.get(id);
    requireCondition(
      entry,
      'OPERATION_NOT_FOUND',
      'This operation is not recorded for the authorized repository.',
      404,
    );
    requireCondition(!this.busy, 'BUSY', 'Wait for the running operation before reconciling.');
    if (entry.operation.status === 'verified' || entry.operation.status === 'rejected') {
      await this.releaseDeadOperationLock(id);
      return entry.operation;
    }
    this.assertSession();
    requireCondition(
      this.trusted,
      'TRUST_REQUIRED',
      'Trust the repository before reconciliation invokes native Git and its credential helpers.',
      403,
    );
    try {
      await this.observe(entry);
      await this.persist(entry);
      if (['verified', 'rejected'].includes(entry.operation.status))
        await this.releaseDeadOperationLock(id);
    } catch (error) {
      entry.operation.status = 'uncertain';
      entry.operation.error = safeError(error);
    }
    return entry.operation;
  }
}
