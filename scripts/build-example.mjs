import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A tiny uncompressed ZIP avoids introducing an archive parser or runtime dependency.
// Input is the explicitly reviewed original example, never a user's selected project.
export function exampleZip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [relative, text] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(relative) ||
      relative.split('/').some((s) => !s || s === '.' || s === '..')
    )
      throw new Error('Unsafe example path.');
    const name = Buffer.from(`community-garden/${relative}`),
      data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(0x21, 14);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    central.push(index, name);
    offset += header.length + name.length + data.length;
  }
  const table = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, table, end]);
}
export async function buildExample() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(root, 'examples/community-garden.json');
  if (!(await lstat(source)).isFile() || (await realpath(source)) !== source)
    throw new Error('Example must be a regular source file.');
  const contents = JSON.parse(await readFile(source, 'utf8'));
  if (!contents.LICENSE || Object.keys(contents).length > 100) throw new Error('Invalid example.');
  const destination = path.join(root, 'dist/web/example');
  await mkdir(destination, { recursive: true });
  if ((await lstat(destination)).isSymbolicLink()) throw new Error('Unsafe example destination.');
  await writeFile(path.join(destination, 'community-garden.zip'), exampleZip(contents));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildExample();
