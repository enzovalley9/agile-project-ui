import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';
import { createPackageArchive, packageArchiveHeaders } from '../../scripts/package-archive.mjs';

it('normalizes tar permissions and extracts through the operating system tar implementation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archive-portability-'));
  try {
    const name = 'synthetic-package';
    const directory = join(root, name);
    for (const path of ['', 'runtime', 'connectors'])
      await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, 'runtime/node'), 'synthetic-runtime');
    await writeFile(join(directory, 'connectors/git.mjs'), 'synthetic-connector');
    await writeFile(join(directory, 'manifest.json'), '{}');
    await chmod(join(directory, 'connectors/git.mjs'), 0o755);
    const files = [
      { path: 'runtime/node', mode: 0o755 },
      { path: 'connectors/git.mjs', mode: 0o644 },
    ];
    const first = join(root, 'first.tar.gz');
    const second = join(root, 'second.tar.gz');
    await createPackageArchive({ root, name, files, output: first });
    await chmod(join(directory, 'connectors/git.mjs'), 0o600);
    await createPackageArchive({ root, name, files, output: second });
    assert.deepEqual(
      await readFile(first),
      await readFile(second),
      'Host modes must not affect packaged bytes.',
    );
    const headers = packageArchiveHeaders(await readFile(first));
    assert.equal(headers.find((entry) => entry.path.endsWith('connectors/git.mjs')).mode, 0o644);
    assert.equal(headers.find((entry) => entry.path.endsWith('runtime/node')).mode, 0o755);
    const extract = join(root, 'extracted');
    await mkdir(extract);
    await promisify(execFile)('tar', ['-xzf', first, '-C', extract]);
    assert.equal(
      await readFile(join(extract, name, 'connectors/git.mjs'), 'utf8'),
      'synthetic-connector',
    );
    if (process.platform !== 'win32') {
      await rm(join(directory, 'connectors/git.mjs'));
      await symlink(join(directory, 'runtime/node'), join(directory, 'connectors/git.mjs'));
      await assert.rejects(
        createPackageArchive({ root, name, files, output: join(root, 'link.tar.gz') }),
        /links are forbidden/,
      );
    }
    await assert.rejects(
      createPackageArchive({
        root,
        name,
        files: [{ path: '../outside', mode: 0o644 }],
        output: join(root, 'unsafe.tar.gz'),
      }),
      /Unsafe archive entry/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
