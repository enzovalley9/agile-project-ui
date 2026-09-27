import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';

const blockSize = 512;
const safePath = (path) =>
  /^[A-Za-z0-9_./-]+$/.test(path) &&
  !path.startsWith('/') &&
  !path.split('/').some((part) => part === '..' || part === '.');

function number(header, value, offset, width) {
  assert(Number.isSafeInteger(value) && value >= 0);
  const octal = value.toString(8);
  assert(octal.length < width, 'Archive field exceeds USTAR capacity.');
  header.write(octal.padStart(width - 1, '0') + '\0', offset, width, 'ascii');
}

// Write only our exact regular-file allowlist. Metadata is independent of umask,
// Windows filesystem modes, build timestamps and the builder's user identity.
export async function createPackageArchive({ root, name, files, output }) {
  assert(safePath(name) && !name.includes('/'));
  const entries = [
    ...['', 'runtime/', 'connectors/'].map((path) => ({ path, directory: true, mode: 0o755 })),
    ...files,
    { path: 'manifest.json', mode: 0o644 },
  ];
  const seen = new Set();
  async function* chunks() {
    for (const entry of entries) {
      const path = `${name}/${entry.path}`;
      assert(safePath(path) && path.length < 100 && !seen.has(path), 'Unsafe archive entry.');
      assert([0o644, 0o755].includes(entry.mode), 'Unexpected archive permissions.');
      seen.add(path);
      const source = join(root, name, entry.path);
      const info = await lstat(source);
      assert(entry.directory ? info.isDirectory() : info.isFile(), 'Archive links are forbidden.');
      const size = entry.directory ? 0 : info.size;
      const header = Buffer.alloc(blockSize);
      header.write(path, 0, 100, 'ascii');
      number(header, entry.mode, 100, 8);
      number(header, 0, 108, 8);
      number(header, 0, 116, 8);
      number(header, size, 124, 12);
      number(header, 0, 136, 12);
      header.fill(32, 148, 156);
      header.write(entry.directory ? '5' : '0', 156, 1, 'ascii');
      header.write('ustar\0', 257, 6, 'ascii');
      header.write('00', 263, 2, 'ascii');
      header.write('root', 265, 32, 'ascii');
      header.write('root', 297, 32, 'ascii');
      const checksum = header.reduce((total, byte) => total + byte, 0);
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      yield header;
      if (!entry.directory) {
        yield* createReadStream(source);
        if (size % blockSize) yield Buffer.alloc(blockSize - (size % blockSize));
      }
    }
    yield Buffer.alloc(blockSize * 2);
  }
  await pipeline(
    Readable.from(chunks()),
    createGzip({ level: 9 }),
    createWriteStream(output, { flags: 'wx' }),
  );
}

// The release gate checks header permissions as well as the manifest. It never
// extracts or executes untrusted CI archives during publication.
export function packageArchiveHeaders(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const entries = [];
  const string = (header, start, width) =>
    header
      .subarray(start, start + width)
      .toString('ascii')
      .replace(/\0.*$/s, '');
  for (let offset = 0; offset < tar.length;) {
    assert(offset + blockSize <= tar.length, 'Truncated archive header.');
    const header = tar.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) {
      assert(
        tar.length - offset >= blockSize * 2 && tar.subarray(offset).every((byte) => byte === 0),
        'Invalid archive trailer.',
      );
      return entries;
    }
    const octal = (start, width) => {
      const value = string(header, start, width).trim();
      assert(/^[0-7]+$/.test(value), 'Invalid archive numeric field.');
      return parseInt(value, 8);
    };
    const sum = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    assert.equal(octal(148, 8), sum, 'Archive header checksum mismatch.');
    const path = string(header, 0, 100);
    const type = string(header, 156, 1);
    assert(safePath(path) && string(header, 345, 155) === '', 'Unexpected archive path.');
    assert(type === '0' || type === '5', 'Archive links and special files are not allowed.');
    assert.equal(string(header, 257, 6), 'ustar', 'Expected normalized USTAR archive.');
    assert.equal(octal(108, 8), 0, 'Archive owner must be normalized.');
    assert.equal(octal(116, 8), 0, 'Archive group must be normalized.');
    const size = octal(124, 12);
    entries.push({ path, mode: octal(100, 8), directory: type === '5' });
    offset += blockSize + Math.ceil(size / blockSize) * blockSize;
    assert(offset <= tar.length, 'Truncated archive content.');
  }
  assert.fail('Missing archive trailer.');
}
