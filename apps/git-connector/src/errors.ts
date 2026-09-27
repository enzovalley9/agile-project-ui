export class GitError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); this.name = 'GitError'; }
}
export function safeError(error: unknown): { code: string; message: string } {
  return error instanceof GitError ? { code: error.code, message: error.message } : { code: 'INTERNAL', message: 'Git could not complete this operation. Inspect the repository with your Git client.' };
}
export function requireCondition(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new GitError(code, message, status);
}
