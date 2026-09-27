import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectProcessLeases, processIdentity } from '../../scripts/launch-connectors.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const source = path.resolve('scripts/launch-connectors.mjs');
async function fixture(startupDelay = 0, slowQuery = false) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'agile-launcher-lifecycle-'));
  const root = path.join(directory, 'connectors');
  await fs.mkdir(path.join(root, 'connectors'), { recursive: true });
  await fs.copyFile(source, path.join(root, 'launch-connectors.mjs'));
  const events = path.join(directory, 'events');
  await fs.writeFile(
    path.join(root, 'connectors', 'git.mjs'),
    `
import { appendFileSync } from 'node:fs';
const event = value => appendFileSync(${JSON.stringify(events)}, value + '\\n');
const hold = setInterval(() => {}, 1000);
event('BOOTED'); await new Promise(resolve => setTimeout(resolve, ${startupDelay}));
let draining = false;
function drain(source) {
  if (draining) { event('DUPLICATE'); return; }
  draining = true; event('BEGIN:' + source);
  setTimeout(() => { event('DONE'); clearInterval(hold); if (process.connected) process.disconnect(); }, 250);
}
process.once('SIGINT', () => drain('SIGINT'));
process.once('SIGTERM', () => drain('SIGTERM'));
process.on('message', value => { if (value.type === 'agile-project-ui:shutdown') drain('IPC'); });
process.once('disconnect', () => { if (!draining) drain('DISCONNECT'); });
event('READY'); if (process.connected) process.send?.({ type: 'agile-project-ui:ready' }); else if (typeof process.send === 'function') drain('DISCONNECT');
`,
  );
  const bin = path.join(directory, 'bin');
  if (slowQuery) {
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, 'ps'),
      `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
appendFileSync(${JSON.stringify(events)}, 'QUERY_READY\\n');
setTimeout(() => { try { process.stdout.write(execFileSync('/bin/ps', process.argv.slice(2))); } catch { process.exitCode = 1; } }, 400);
`,
      { mode: 0o755 },
    );
  }
  return { directory, root, events, bin };
}
async function waitFor(file, text) {
  for (let n = 0; n < 200; n++) {
    const value = await fs.readFile(file, 'utf8').catch(() => '');
    if (value.includes(text)) return value;
    await pause(25);
  }
  throw new Error('Lifecycle fixture did not reach ' + text);
}
for (const scenario of [
  'foreground SIGINT',
  'foreground SIGINT during process query',
  'launcher SIGTERM',
  'startup SIGTERM',
]) {
  test(
    `launcher drains exactly once after ${scenario}`,
    {
      skip: process.platform === 'win32' && scenario.startsWith('foreground SIGINT'),
      timeout: 20000,
    },
    async () => {
      const slowQuery = scenario === 'foreground SIGINT during process query';
      const f = await fixture(scenario === 'startup SIGTERM' ? 300 : 0, slowQuery);
      const child = spawn(process.execPath, [path.join(f.root, 'launch-connectors.mjs'), 'git'], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: slowQuery
          ? { ...process.env, PATH: f.bin + path.delimiter + process.env.PATH }
          : process.env,
      });
      let errorOutput = '';
      child.stderr.on('data', (chunk) => {
        errorOutput += chunk;
      });
      const closed = new Promise((resolve) =>
        child.once('close', (code, signal) => resolve({ code, signal })),
      );
      try {
        await waitFor(f.events, scenario === 'startup SIGTERM' ? 'BOOTED' : 'READY').catch(
          async (error) => {
            throw new Error(
              `${error.message}; launcher exit=${child.exitCode}, signal=${child.signalCode}, stderr=${errorOutput}`,
            );
          },
        );
        if (slowQuery) await waitFor(f.events, 'QUERY_READY');
        if (scenario.startsWith('foreground SIGINT')) {
          process.kill(-child.pid, 'SIGINT');
          // A second quick Ctrl+C is owned by the launcher; it must not re-send.
          process.kill(-child.pid, 'SIGINT');
        } else child.kill('SIGTERM');
        const events = await waitFor(f.events, 'DONE');
        const result = await closed;
        assert.equal((events.match(/BEGIN:/g) || []).length, 1);
        assert(!events.includes('DUPLICATE'), events);
        assert.match(events, process.platform === 'win32' ? /BEGIN:DISCONNECT/ : /BEGIN:IPC/);
        if (process.platform !== 'win32') assert.equal(result.code, 0, errorOutput);
        await inspectProcessLeases(f.root, true);
        assert.deepEqual(await fs.readdir(f.root + '.running'), []);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await fs.rm(f.directory, { recursive: true, force: true });
      }
    },
  );
}
test('process leases remove reused PIDs without touching the unrelated live process', async () => {
  const f = await fixture();
  const registry = f.root + '.running';
  await fs.mkdir(registry);
  const file = path.join(registry, process.pid + '.json');
  try {
    const identity = await processIdentity(process.pid);
    assert(identity);
    await fs.writeFile(
      file,
      JSON.stringify({ pid: process.pid, identity: process.platform + ':expired birth identity' }),
    );
    await inspectProcessLeases(f.root, true);
    await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    process.kill(process.pid, 0); // Still alive; no terminating signal is used.
    await fs.writeFile(file, JSON.stringify({ pid: process.pid, identity }));
    await assert.rejects(inspectProcessLeases(f.root, true), /still running/);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).identity, identity);
    await fs.writeFile(file, JSON.stringify({ pid: process.pid }));
    await assert.rejects(inspectProcessLeases(f.root, true), /legacy lease/);
    await fs.writeFile(file, '{broken');
    await assert.rejects(inspectProcessLeases(f.root, true), /Invalid connector process registry/);
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
