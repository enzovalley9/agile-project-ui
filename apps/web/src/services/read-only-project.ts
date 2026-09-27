import { LIMITS, ProjectError, safePath } from './project-store';

const denied = () => new DOMException('This snapshot is read-only.', 'NotAllowedError');
const missing = () => new DOMException('File not found in this snapshot.', 'NotFoundError');
const permission = async (
  options?: FileSystemHandlePermissionDescriptor,
): Promise<PermissionState> => (options?.mode === 'readwrite' ? 'denied' : 'granted');

/** Immutable, browser-local snapshot. No writable handles or live filesystem access. */
export function readOnlyDirectory(
  contents: Record<string, string>,
  name: string,
): FileSystemDirectoryHandle {
  const files = new Map<string, File>();
  const directories = new Set(['']);
  let total = 0;
  const entries = Object.entries(contents);
  if (entries.length > LIMITS.files)
    throw new ProjectError('file-limit', 'Too many imported files.');
  for (const [path, text] of entries) {
    const parts = safePath(path);
    if (parts.length > LIMITS.depth || typeof text !== 'string')
      throw new Error('Invalid snapshot entry.');
    const file = new File([text], parts.at(-1)!);
    total += file.size;
    if (file.size > LIMITS.bytesPerFile || total > LIMITS.totalBytes)
      throw new ProjectError('size-limit', 'The snapshot exceeds the supported text size limits.');
    files.set(path, file);
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  for (const path of files.keys())
    if (directories.has(path)) throw new Error('Conflicting snapshot paths.');
  const fileHandle = (path: string): FileSystemFileHandle =>
    ({
      kind: 'file',
      name: path.split('/').at(-1)!,
      queryPermission: permission,
      requestPermission: permission,
      isSameEntry: async () => false,
      getFile: async () => files.get(path)!,
      createWritable: async () => {
        throw denied();
      },
    }) as unknown as FileSystemFileHandle;
  const directory = (base: string): FileSystemDirectoryHandle =>
    ({
      kind: 'directory',
      name: base ? base.split('/').at(-1)! : name,
      queryPermission: permission,
      requestPermission: permission,
      isSameEntry: async () => false,
      getFileHandle: async (child: string, options?: FileSystemGetFileOptions) => {
        if (options?.create) throw denied();
        const path = base ? `${base}/${child}` : child;
        if (!files.has(path) || child.includes('/')) throw missing();
        return fileHandle(path);
      },
      getDirectoryHandle: async (child: string, options?: FileSystemGetDirectoryOptions) => {
        if (options?.create) throw denied();
        const path = base ? `${base}/${child}` : child;
        if (!directories.has(path) || child.includes('/')) throw missing();
        return directory(path);
      },
      removeEntry: async () => {
        throw denied();
      },
      entries: async function* () {
        const prefix = base ? `${base}/` : '';
        for (const path of directories) {
          const relative = path.slice(prefix.length);
          if (path.startsWith(prefix) && relative && !relative.includes('/'))
            yield [relative, directory(path)];
        }
        for (const path of files.keys()) {
          const relative = path.slice(prefix.length);
          if (path.startsWith(prefix) && !relative.includes('/'))
            yield [relative, fileHandle(path)];
        }
      },
    }) as unknown as FileSystemDirectoryHandle;
  return directory('');
}

/** Import only selected text, preserving relative paths; never upload it. */
export async function importReadOnlyFiles(selection: readonly File[]) {
  if (selection.length > LIMITS.files)
    throw new Error('Select a smaller folder (at most 5,000 files).');
  const name = selection[0]?.webkitRelativePath.split('/')[0] || 'Imported files';
  const pathOf = (file: File) =>
    file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
  const paths = selection.map(pathOf);
  const nested = paths.flatMap((path) => {
    const parts = path.split('/');
    const at = parts.indexOf('.git');
    return at > 0 ? [parts.slice(0, at).join('/') + '/'] : [];
  });
  const entries: [string, string][] = [];
  let total = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const [index, file] of selection.entries()) {
    const path = paths[index];
    try {
      safePath(path);
    } catch {
      skipped++;
      continue;
    }
    if (
      nested.some((prefix) => path.startsWith(prefix)) ||
      !/\.(md|mdx|txt|yaml|yml|toml|json|csv|html|xml)$/i.test(path)
    ) {
      skipped++;
      continue;
    }
    if (file.size > LIMITS.bytesPerFile || total + file.size > LIMITS.totalBytes)
      throw new Error(
        'Selected text exceeds 2 MiB per file or 32 MiB in total. Select a smaller folder.',
      );
    if (seen.has(path))
      throw new Error('Selected files have duplicate paths. Import a folder instead.');
    seen.add(path);
    total += file.size;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
    if (text.includes('\0')) {
      skipped++;
      continue;
    }
    entries.push([path, text]);
  }
  if (!entries.length) throw new Error('No supported UTF-8 text files were selected.');
  return { handle: readOnlyDirectory(Object.fromEntries(entries), name), skipped };
}
