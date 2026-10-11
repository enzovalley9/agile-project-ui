import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { renameDirectory } from '../../scripts/launch-connectors.mjs';

const from = path.join('user install', 'connectors'),
  to = from + '.previous';
const refused = (code) =>
  Object.assign(new Error(`${code}: simulated sharing violation, rename`), { code });
/**
 * Replaces fs.rename the same way the package smoke test injects installer
 * faults. Nothing touches the disk: a real rename on Windows could meet the
 * very lock this covers.
 */
function fixture(t, failure) {
  const calls = [],
    waits = [];
  t.mock.method(fs, 'rename', async (...args) => {
    calls.push(args);
    const error = failure(calls.length);
    if (error) throw error;
  });
  // Recorded instead of slept, so the complete schedule is asserted in no time.
  return { calls, waits, wait: async (ms) => void waits.push(ms) };
}
const attempts = (count) => Array.from({ length: count }, () => [from, to]);
for (const code of ['EPERM', 'EBUSY', 'EACCES'])
  test(`a Windows rename refused twice with ${code} succeeds once the handle is released`, async (t) => {
    const f = fixture(t, (attempt) => attempt <= 2 && refused(code));
    await renameDirectory(from, to, 'win32', f.wait);
    assert.deepEqual(f.calls, attempts(3));
    assert.deepEqual(f.waits, [50, 100]);
  });
test('a Windows rename that stays refused fails with its own error after bounded, growing waits', async (t) => {
  let last;
  const f = fixture(t, () => (last = refused('EPERM')));
  await assert.rejects(
    renameDirectory(from, to, 'win32', f.wait),
    (error) => error === last && error.code === 'EPERM',
  );
  assert.deepEqual(f.calls, attempts(8));
  assert.deepEqual(f.waits, [50, 100, 200, 400, 800, 1600, 3200]);
});
for (const [name, platform, failure] of [
  ['EPERM on Linux', 'linux', () => refused('EPERM')],
  ['EBUSY on macOS', 'darwin', () => refused('EBUSY')],
  ['ENOENT on Windows', 'win32', () => refused('ENOENT')],
  // The package smoke test injects failures like this one; a retry must not hide them.
  ['A failure without a code on Windows', 'win32', () => new Error('Simulated activation failure')],
])
  test(`${name} is not retried`, async (t) => {
    let thrown;
    const f = fixture(t, () => (thrown = failure()));
    await assert.rejects(renameDirectory(from, to, platform, f.wait), (error) => error === thrown);
    assert.deepEqual(f.calls, attempts(1));
    assert.deepEqual(f.waits, []);
  });
test('the default wait is a real delay and the platform defaults to the running one', async (t) => {
  const f = fixture(t, (attempt) => attempt <= 2 && refused('EPERM'));
  await renameDirectory(from, to, 'win32');
  assert.deepEqual(f.calls, attempts(3));
  f.calls.length = 0;
  if (process.platform === 'win32') {
    await renameDirectory(from, to);
    assert.deepEqual(f.calls, attempts(3));
  } else {
    await assert.rejects(renameDirectory(from, to), { code: 'EPERM' });
    assert.deepEqual(f.calls, attempts(1));
  }
});
