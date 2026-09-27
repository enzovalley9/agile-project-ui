import { serve } from '@hono/node-server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGitApp } from './app';
import { GitError, requireCondition, safeError } from './errors';

export function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  const allowed = new Set(['--repo', '--origin', '--port', '--token-file']);
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(
      allowed.has(args[index]) &&
        typeof args[index + 1] === 'string' &&
        !args[index + 1].startsWith('--') &&
        !values.has(args[index]),
      'ARGUMENTS',
      'Usage: agile-git --repo PATH --origin URL --token-file PRIVATE_PATH [--port 43120]',
      400,
    );
    values.set(args[index], args[index + 1]);
  }
  for (const key of ['--repo', '--origin', '--token-file'])
    requireCondition(values.has(key), 'ARGUMENTS', `Required argument: ${key}`, 400);
  const port = Number(values.get('--port') ?? '43120');
  requireCondition(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    'ARGUMENTS',
    'Choose a port between 1024 and 65535.',
    400,
  );
  return {
    repo: path.resolve(values.get('--repo')!),
    origin: values.get('--origin')!,
    tokenFile: path.resolve(values.get('--token-file')!),
    port,
  };
}

export async function startGitConnector(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: agile-connectors git --repo PATH --origin URL --token-file PRIVATE_PATH [--port 43120]\n',
    );
    return;
  }
  const { repo, origin, tokenFile, port } = parseArguments(args);
  const root = await fs.realpath(repo);
  const tokenParent = await fs.realpath(path.dirname(tokenFile));
  requireCondition(
    tokenParent !== root && !tokenParent.startsWith(root + path.sep),
    'TOKEN_LOCATION',
    'The capability file must be outside the repository.',
    400,
  );
  let token: string;
  try {
    const handle = await fs.open(tokenFile, 'wx', 0o600);
    token = randomBytes(32).toString('hex');
    try {
      await handle.writeFile(token + '\n');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = await fs.lstat(tokenFile);
    requireCondition(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= 4096 &&
        (process.platform === 'win32' || (stat.mode & 0o077) === 0),
      'TOKEN_PERMISSIONS',
      'The capability file must be a small private regular file.',
      400,
    );
    token = (await fs.readFile(tokenFile, 'utf8')).trim();
  }
  const app = createGitApp({ repo: root, origin, token, port });
  await app.service.ready;
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  // Never print tokens, URLs with credentials, command output or repository contents.
  process.stdout.write(
    `Git connector listening on 127.0.0.1:${port}. Local capability is in the configured private file.\n`,
  );
  return server;
}

const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (executedFile === fileURLToPath(import.meta.url)) {
  startGitConnector().catch((error: unknown) => {
    process.stderr.write(`${safeError(error).message}\n`);
    process.exitCode = 1;
  });
}
