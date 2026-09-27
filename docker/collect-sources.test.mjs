import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inventory, sourceChecksums, verifySourceDirectory } from './collect-sources.mjs';

test('binary inventories preserve Debian source versions, epochs and architecture suffixes', () => {
  assert.deepEqual(inventory('libgit:arm64\t1:2.0-1+b1\tarm64\tgit\t1:2.0-1\n'), [
    {
      name: 'libgit:arm64',
      version: '1:2.0-1+b1',
      architecture: 'arm64',
      source: 'git',
      sourceVersion: '1:2.0-1',
    },
  ]);
  for (const text of [
    'git\t1\tarm64\t../git\t1',
    'git\t1;echo\tarm64\tgit\t1',
    'git\t1\tarm64\tgit\t1\ngit\t1\tarm64\tgit\t1',
  ])
    assert.throws(() => inventory(text));
});

test('source verification rejects identity drift, traversal, tampering, omissions and symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agile-source-test-'));
  const content = 'original source\n';
  const hash = createHash('sha256').update(content).digest('hex');
  const dsc = `Source: git\nVersion: 1:2.0-1\nChecksums-Sha256:\n ${hash} ${Buffer.byteLength(content)} git_2.0.orig.tar.xz\n`;
  try {
    await writeFile(path.join(dir, 'git.dsc'), dsc);
    await writeFile(path.join(dir, 'git_2.0.orig.tar.xz'), content);
    assert.equal((await verifySourceDirectory(dir, 'git', '1:2.0-1')).length, 2);
    assert.throws(() => sourceChecksums(dsc, 'other', '1:2.0-1'));
    assert.throws(() => sourceChecksums(dsc, 'git', '1:2.0-2'));
    assert.throws(() =>
      sourceChecksums(dsc.replace('git_2.0.orig.tar.xz', '../outside'), 'git', '1:2.0-1'),
    );
    await writeFile(path.join(dir, 'git_2.0.orig.tar.xz'), 'tampered source\n');
    await assert.rejects(verifySourceDirectory(dir, 'git', '1:2.0-1'));
    await rm(path.join(dir, 'git_2.0.orig.tar.xz'));
    await assert.rejects(verifySourceDirectory(dir, 'git', '1:2.0-1'));
    await symlink('git.dsc', path.join(dir, 'git_2.0.orig.tar.xz'));
    await assert.rejects(verifySourceDirectory(dir, 'git', '1:2.0-1'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
