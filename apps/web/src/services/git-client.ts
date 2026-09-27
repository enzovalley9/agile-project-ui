import type {
  GitRepository,
  GitPlan,
  GitOperation,
  MutationContext,
  PlanKind,
} from '../../../git-connector/src/types';
import type { ProjectStore } from './project-store';
export type { GitRepository, GitPlan, GitOperation, MutationContext, PlanKind };
export interface GitBranch {
  name: string;
  current: boolean;
  worktree?: string;
}
export class ConnectorError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const rejectedBeforeExecution = new Set([
  'PLAN_EXPIRED',
  'STALE_PLAN',
  'TRUST_REQUIRED',
  'BINDING_REQUIRED',
  'INVALID_BINDING',
  'SESSION_REQUIRED',
  'AUTH_REQUIRED',
  'HOST_DENIED',
  'ORIGIN_DENIED',
  'GIT_CONFLICT',
  'REPOSITORY_CHANGED',
  'AUTHENTICATION_REQUIRED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ORIGIN',
  'INVALID_ORIGIN',
  'INVALID_HOST',
  'BUSY',
  'CONTEXT_REQUIRED',
  'SAVE_IN_PROGRESS',
  'UNSAVED_DRAFTS',
  'INVALID_CONTEXT',
  'DETACHED_HEAD',
  'GIT_LOCKED',
  'CONFLICTS',
  'OPERATION_IN_PROGRESS',
  'FOREIGN_INDEX',
  'CORRUPT_JOURNAL',
  'RECOVERY_REQUIRED',
]);
export function definitiveRejection(error: unknown) {
  return error instanceof ConnectorError && rejectedBeforeExecution.has(error.code);
}
/** Session capability is deliberately memory-only and never part of project files. */
export class GitClient {
  private token = '';
  private binding = '';
  private store?: ProjectStore;
  private expected?: { branch: string | null; head: string | null };
  private pending = false;
  private async assertProjectContext() {
    if (this.pending)
      throw new ConnectorError('recovery-pending', 'Check the Git result before saving documents.');
    const repo = await this.repository();
    if (!this.expected || repo.branch !== this.expected.branch || repo.head !== this.expected.head)
      throw new ConnectorError(
        'git-context-changed',
        'The branch or commit changed outside this view. Keep your drafts, reload the project, and reconnect Git before saving.',
      );
    if (repo.operationInProgress.length || repo.conflicts.length)
      throw new ConnectorError(
        'git-operation-pending',
        'Resolve the Git operation or conflicts before saving.',
      );
  }
  private context(context: MutationContext) {
    return {
      ...context,
      saving: context.saving || !!this.store?.mutationPending,
      recoveryPending: context.recoveryPending || !!this.store?.recoveryPending || this.pending,
    };
  }
  private async observe(operation: GitOperation) {
    this.pending = operation.status === 'running' || operation.status === 'uncertain';
    if (operation.status === 'verified') {
      const repo = await this.repository();
      if (operation.head && repo.head !== operation.head) {
        this.pending = true;
        throw new ConnectorError(
          'git-context-changed',
          'Git changed after the operation. Review the result before saving.',
        );
      }
      this.expected = { branch: repo.branch, head: repo.head };
    }
    return operation;
  }
  readonly baseUrl: string;
  constructor(url = 'http://127.0.0.1:43120') {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new ConnectorError(
        'invalid-endpoint',
        'The connector must use a local HTTP address without a path or credentials.',
      );
    this.baseUrl = parsed.origin;
  }
  get connected() {
    return !!this.token && !!this.binding;
  }
  private async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.binding) headers['X-BMAD-Binding'] = this.binding;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path === '/v1/operations' ? 125000 : 20000),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new ConnectorError(
        'unreachable',
        'No response was received from the connector. If an operation was in progress, check its result before repeating it.',
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw new ConnectorError(
        data?.error?.code ?? 'connector-error',
        data?.error?.message ?? 'The connector rejected the operation.',
      );
    return data as T;
  }
  health() {
    return this.request<{ version: string; service?: string }>('/v1/health');
  }
  async connect(store: ProjectStore, token: string, trustRepository: boolean) {
    if (!trustRepository)
      throw new ConnectorError(
        'trust-required',
        'Confirm that you trust the repository hooks, filters, and credential helpers.',
      );
    if (store.mode !== 'edit')
      throw new ConnectorError(
        'editor-required',
        'Enable Editor mode to verify the folder using a temporary marker.',
      );
    this.token = token;
    this.binding = '';
    try {
      await this.request('/v1/session', { trustRepository });
      const challenge = await this.request<{
        id: string;
        path: string;
        content: string;
        expiresAt: string;
      }>('/v1/bindings/challenge', {});
      if (!/^\.bmad-project-ui\/local\/git-bindings\/[a-zA-Z0-9-]+\.json$/.test(challenge.path))
        throw new ConnectorError(
          'invalid-challenge',
          'The connector returned an invalid binding path.',
        );
      await store.save(challenge.path, challenge.content, null);
      const binding = await this.request<{
        bindingId: string;
        rootName: string;
        removePath?: string;
      }>('/v1/bindings/verify', { id: challenge.id });
      this.binding = binding.bindingId;
      await store.removeTransientBinding(challenge.path);
      const repo = await this.repository();
      this.expected = { branch: repo.branch, head: repo.head };
      const unresolved = await this.pendingOperations();
      this.pending = unresolved.operations.some(
        (op) => op.status === 'running' || op.status === 'uncertain',
      );
      this.store = store;
      store.setMutationGuard(() => this.assertProjectContext());
      return repo;
    } catch (error) {
      this.binding = '';
      this.token = '';
      throw error;
    }
  }
  async disconnect() {
    try {
      if (this.token) await this.request('/v1/session', undefined, 'DELETE');
    } finally {
      this.token = '';
      this.binding = '';
      this.store?.setMutationGuard();
      this.store = undefined;
      this.expected = undefined;
      this.pending = false;
    }
  }
  repository() {
    return this.request<GitRepository>('/v1/repository');
  }
  branches() {
    return this.request<{ branches: GitBranch[] }>('/v1/branches');
  }
  planCommit(paths: string[], message: string, context: MutationContext) {
    return this.request<GitPlan>('/v1/plans/commit', { paths, message, ...this.context(context) });
  }
  planBranch(branch: string, context: MutationContext) {
    return this.request<GitPlan>('/v1/plans/branch', { branch, ...this.context(context) });
  }
  planPush(remote: string, branch: string, context: MutationContext) {
    return this.request<GitPlan>('/v1/plans/push', { remote, branch, ...this.context(context) });
  }
  async execute(planId: string, context: MutationContext) {
    const run = async () => {
      await this.store?.recoveryStatus();
      const actual = this.context(context);
      this.pending = true;
      try {
        return await this.observe(
          await this.request<GitOperation>('/v1/operations', { planId, ...actual }),
        );
      } catch (e) {
        this.pending = !definitiveRejection(e);
        throw e;
      }
    };
    return this.store ? this.store.withProjectLock(run) : run();
  }
  operation(id: string) {
    return this.request<GitOperation>('/v1/operations/' + encodeURIComponent(id));
  }
  async operationByPlan(planId: string) {
    return this.observe(
      await this.request<GitOperation>('/v1/operations/by-plan/' + encodeURIComponent(planId)),
    );
  }
  pendingOperations() {
    return this.request<{ operations: GitOperation[]; hasMore: boolean }>('/v1/operations');
  }
  async reconcile(id: string) {
    return this.observe(
      await this.request<GitOperation>(
        '/v1/operations/' + encodeURIComponent(id) + '/reconcile',
        {},
      ),
    );
  }
}
