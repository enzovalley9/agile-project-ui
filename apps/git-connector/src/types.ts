export type GitChange = { path: string; index: string; workingTree: string; originalPath?: string };
export type GitRepository = {
  rootName: string;
  branch: string | null;
  head: string | null;
  changes: GitChange[];
  conflicts: string[];
  staged: string[];
  dirty: boolean;
  remotes: { name: string; url: string }[];
  operationInProgress: string[];
  trusted: boolean;
};
export type ReviewFile = { path: string; status: string; diff: string };
export type OutgoingCommit = { sha: string; subject: string; files: ReviewFile[] };
export type MutationContext = { drafts: number; saving: boolean; recoveryPending: boolean };
export type PlanKind = 'commit' | 'branch' | 'push';
export type GitPlan = {
  id: string;
  kind: PlanKind;
  expiresAt: string;
  summary: string;
  head: string | null;
  files: ReviewFile[];
  commits?: OutgoingCommit[];
  remote?: string;
  branch?: string;
  remoteUrl?: string;
};
export type GitOperation = {
  id: string;
  planId: string;
  kind: PlanKind;
  status: 'running' | 'verified' | 'rejected' | 'uncertain';
  startedAt: string;
  completedAt?: string;
  head?: string;
  remoteSha?: string;
  error?: { code: string; message: string };
  warning?: string;
};
export type CommandResult = { stdout: string; stderr: string; exitCode: number };
export type GitRunner = (
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
) => Promise<CommandResult>;
export type GitOptions = {
  repo: string;
  origin: string;
  token: string;
  port?: number;
  stateDir?: string;
  allowLocalRemotes?: boolean;
  runner?: GitRunner;
  now?: () => number;
  planTtlMs?: number;
  commandTimeoutMs?: number;
};
