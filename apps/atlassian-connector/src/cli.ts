#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { randomBytes, createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createAdapter } from './adapters';
import { createAtlassianApp } from './service';
import { normalizeInstance, ProviderTransport } from './transport';
async function privateFile(path: string): Promise<string> {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 16384 ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw new Error('Credential and capability files must be private regular files (mode 0600)');
  return readFile(path, 'utf8');
}
export function parseArguments(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      provider: { type: 'string' },
      deployment: { type: 'string', default: 'cloud' },
      instance: { type: 'string' },
      origin: { type: 'string' },
      port: { type: 'string' },
      'listen-host': { type: 'string', default: '127.0.0.1' },
      'token-file': { type: 'string' },
      'credentials-file': { type: 'string' },
      'journal-directory': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const listenHost = values['listen-host'];
  if (listenHost !== '127.0.0.1' && listenHost !== '0.0.0.0')
    throw new Error('Listen host must be 127.0.0.1 or 0.0.0.0 (container publishing only)');
  return values;
}
export async function main(args = process.argv.slice(2)) {
  const values = parseArguments(args);
  if (values.help) {
    console.log(
      'Agile Project UI independent Atlassian connector\n--provider jira|confluence --deployment cloud|data-center --instance https://example.atlassian.net --origin http://localhost:5173 --token-file /private/path/capability --credentials-file /private/path/credentials.json [--port 43121|43122] [--listen-host 127.0.0.1|0.0.0.0]',
    );
    return;
  }
  if (
    !['jira', 'confluence'].includes(values.provider ?? '') ||
    !['cloud', 'data-center'].includes(values.deployment ?? '') ||
    !values.instance ||
    !values.origin ||
    !values['token-file']
  )
    throw new Error('Provider, instance, origin and token-file are required');
  const provider = values.provider as 'jira' | 'confluence',
    deployment = values.deployment as 'cloud' | 'data-center';
  const instance = normalizeInstance(values.instance);
  const origin = new URL(values.origin);
  if (origin.origin !== values.origin) throw new Error('Origin must be exact');
  const port = Number(values.port ?? (provider === 'jira' ? 43121 : 43122));
  const tokenFile = resolve(values['token-file']);
  let token: string;
  try {
    token = (await privateFile(tokenFile)).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
    token = randomBytes(32).toString('base64url');
    await writeFile(tokenFile, token + '\n', { mode: 0o600, flag: 'wx' });
  }
  let credentials: {
    authorization?: string;
    email?: string;
    apiToken?: string;
    bearerToken?: string;
  };
  if (values['credentials-file']) {
    credentials = JSON.parse(await privateFile(resolve(values['credentials-file'])));
    if (
      Object.keys(credentials).some(
        (k) => !['authorization', 'email', 'apiToken', 'bearerToken'].includes(k),
      )
    )
      throw new Error('Unknown credential fields');
  } else
    credentials = {
      bearerToken: process.env.AGILE_PROJECT_UI_ATLASSIAN_BEARER_TOKEN,
      email: process.env.AGILE_PROJECT_UI_ATLASSIAN_EMAIL,
      apiToken: process.env.AGILE_PROJECT_UI_ATLASSIAN_API_TOKEN,
    };
  const modes =
    Number(!!credentials.authorization) +
    Number(!!credentials.bearerToken) +
    Number(!!credentials.email || !!credentials.apiToken);
  if (modes !== 1)
    throw new Error(
      'Provide one authorization, bearer token, or email and API token credential profile',
    );
  const authorization =
    credentials.authorization ??
    (credentials.bearerToken
      ? 'Bearer ' + credentials.bearerToken
      : credentials.email && credentials.apiToken
        ? 'Basic ' + Buffer.from(credentials.email + ':' + credentials.apiToken).toString('base64')
        : '');
  if (!authorization) throw new Error('Provider credentials are required');
  const adapter = createAdapter({
    provider,
    deployment,
    transport: new ProviderTransport({ instance, authorization }),
  });
  const instanceKey = createHash('sha256').update(instance).digest('hex').slice(0, 16);
  const app = await createAtlassianApp({
    adapter,
    origin: values.origin,
    port,
    launcherToken: token,
    // Preserve historical operation journals through the product rename.
    journalDirectory: values['journal-directory']
      ? resolve(values['journal-directory'])
      : join(homedir(), '.bmad-project-ui', 'atlassian', provider, instanceKey),
  });
  const server = serve({ fetch: app.fetch, hostname: values['listen-host'], port });
  console.log(
    `${provider} connector listening on ${values['listen-host']}:${port}; capability file: ${tokenFile}`,
  );
  const shutdown = () => {
    server.close();
    setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }, 10_000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error(
      'Atlassian connector could not start. Check configuration, private file permissions and credential profile.',
    );
    process.exitCode = 1;
  });
