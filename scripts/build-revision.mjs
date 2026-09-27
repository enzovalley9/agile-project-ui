import { execFileSync } from 'node:child_process';

// Container builds exclude Git history. Source builds still read Git by default.
export function buildRevision(projectRoot, env = process.env) {
  const revision =
    env.AGILE_PROJECT_UI_BUILD_REVISION ??
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  if (!/^[a-f\d]{40}$/.test(revision))
    throw new Error('AGILE_PROJECT_UI_BUILD_REVISION must be a full lowercase Git revision.');
  return revision;
}
