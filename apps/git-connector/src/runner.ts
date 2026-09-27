import { spawn } from 'node:child_process';
import { GitError } from './errors';
import type { GitRunner } from './types';

const identityVariables = new Set([
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
]);
const MAX_OUTPUT = 8 * 1024 * 1024;
export const nativeGitRunner: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    // Credentials and signing remain native. Disable inherited Git routing/index overrides.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith('GIT_') && !identityVariables.has(key)) delete env[key];
    Object.assign(env, {
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: 'cat',
      LC_ALL: 'C',
      ...options.env,
      // Reviews and transport must see the same real objects. An explicitly empty
      // graft path disables legacy info/grafts without a check/read race or temp file.
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_GRAFT_FILE: '',
    });
    const child = spawn('git', ['--no-replace-objects', ...args], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill('SIGKILL'));
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (error?: Error, code = 0) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: code,
        });
    };
    const timer = setTimeout(() => {
      terminate();
      finish(
        new GitError('TIMEOUT', 'Git timed out. Its outcome must be checked before trying again.'),
      );
    }, options.timeoutMs);
    const collect = (target: Buffer[]) => (data: Buffer) => {
      size += data.length;
      if (size > MAX_OUTPUT) {
        terminate();
        finish(
          new GitError(
            'OUTPUT_LIMIT',
            'Git output exceeded the review limit. Narrow the operation.',
          ),
        );
      } else target.push(data);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', () =>
      finish(
        new GitError(
          'GIT_UNAVAILABLE',
          'Git is unavailable. Install Git or check the connector launch environment.',
          503,
        ),
      ),
    );
    child.on('close', (code) => finish(undefined, code ?? 1));
  });
