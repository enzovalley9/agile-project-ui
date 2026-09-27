import { parseDocument, isMap, isSeq, isScalar, type Document } from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Diagnostic, DocumentLink, FileSnapshot, Heading, SourceRef } from './types';

export const EXCLUDED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  '.next',
  '.cache',
  '.venv',
  '.codex',
  '.claude',
  '.agents',
  '.idea',
  '.vscode',
]);
export function isSafePath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[A-Za-z]:/.test(path) &&
    !path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          EXCLUDED_SEGMENTS.has(part) ||
          /^\.env(?:\.|$)/i.test(part) ||
          /^(secrets?|\.secrets)$/i.test(part) ||
          /\.(pem|key|p12|pfx|keystore)$/i.test(part),
      )
  );
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function textValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
export function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}
export function ref(
  path: string,
  revision: string,
  text: string,
  start: number,
  end: number,
  locator: string,
): SourceRef {
  return {
    path,
    revision,
    locator,
    start,
    end,
    line: lineAt(text, start),
    lineStart: lineAt(text, start),
    lineEnd: lineAt(text, Math.max(start, end - 1)),
  };
}
export interface ParsedYaml {
  data: unknown;
  document: Document;
  valid: boolean;
  offset: number;
}
export function parseYaml(
  text: string,
  path: string,
  diagnostics: Diagnostic[],
  offset = 0,
): ParsedYaml {
  const document = parseDocument(text, {
    uniqueKeys: true,
    strict: true,
    prettyErrors: false,
    keepSourceTokens: true,
  });
  let data: unknown;
  try {
    if (document.errors.length)
      throw new Error(document.errors.map((error) => error.message).join('; '));
    if (document.warnings.length)
      throw new Error(document.warnings.map((error) => error.message).join('; '));
    data = document.toJS({ maxAliasCount: 50 });
  } catch (error) {
    diagnostics.push({
      code: 'invalid-yaml',
      severity: 'error',
      path,
      message: `Cannot parse YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { data: undefined, document, valid: false, offset };
  }
  return { data, document, valid: true, offset };
}
/** CST ranges allow writes to one scalar without reserializing neighbors. */
export function yamlScalar(
  parsed: ParsedYaml,
  keys: (string | number)[],
): { start: number; end: number; value: string } | undefined {
  if (!parsed.valid) return;
  let node: unknown = parsed.document.contents;
  for (const key of keys) {
    if (isMap(node)) node = node.get(key, true);
    else if (isSeq(node) && typeof key === 'number') node = node.items[key];
    else return;
  }
  if (
    !isScalar(node) ||
    !node.range ||
    (typeof node.value !== 'string' &&
      typeof node.value !== 'number' &&
      typeof node.value !== 'boolean')
  )
    return;
  return {
    start: parsed.offset + node.range[0],
    end: parsed.offset + node.range[1],
    value: String(node.value),
  };
}
export function frontmatter(
  text: string,
  path: string,
  diagnostics: Diagnostic[],
): { parsed?: ParsedYaml; metadata: Record<string, unknown>; bodyStart: number; valid: boolean } {
  const start = text.startsWith('\uFEFF') ? 1 : 0;
  const opener = /^(---)[ \t]*\r?\n/.exec(text.slice(start));
  if (!opener) return { metadata: {}, bodyStart: start, valid: true };
  const offset = start + opener[0].length;
  const closing = /^(---|\.\.\.)[ \t]*\r?$/m.exec(text.slice(offset));
  if (!closing) {
    diagnostics.push({
      code: 'invalid-frontmatter',
      severity: 'error',
      path,
      message: 'Frontmatter has no closing delimiter. Text editing remains available.',
    });
    return { metadata: {}, bodyStart: start, valid: false };
  }
  const parsed = parseYaml(text.slice(offset, offset + closing.index), path, diagnostics, offset);
  let bodyStart = offset + closing.index + closing[0].length;
  if (text[bodyStart] === '\n') bodyStart++;
  if (parsed.valid && !isRecord(parsed.data)) {
    diagnostics.push({
      code: 'invalid-frontmatter',
      severity: 'error',
      path,
      message: 'Expected a metadata mapping; structured forms are disabled.',
    });
    return { parsed, metadata: {}, bodyStart, valid: false };
  }
  return { parsed, metadata: safeRecord(parsed.data), bodyStart, valid: parsed.valid };
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  checked?: boolean | null;
  children?: MarkdownNode[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number; line: number } };
}
const processor = unified().use(remarkParse).use(remarkGfm);
function visibleText(node: MarkdownNode): string {
  return node.value ?? (node.children?.map(visibleText).join('') || '');
}
function walk(node: MarkdownNode, fn: (node: MarkdownNode) => void) {
  fn(node);
  node.children?.forEach((child) => walk(child, fn));
}
export function markdownTree(text: string, bodyStart = 0): MarkdownNode {
  // Keep offsets/line numbers exact while preventing YAML from becoming headings.
  const hidden = text.slice(0, bodyStart).replace(/[^\r\n]/g, ' ');
  return processor.parse(hidden + text.slice(bodyStart)) as MarkdownNode;
}
export function headingAnchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}
export function markdownHeadings(
  tree: MarkdownNode,
  text: string,
  path: string,
  revision: string,
): Heading[] {
  const result: Heading[] = [];
  const counts = new Map<string, number>();
  walk(tree, (node) => {
    if (node.type !== 'heading' || !node.position) return;
    const title = visibleText(node);
    const base = headingAnchor(title);
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    result.push({
      ...ref(
        path,
        revision,
        text,
        node.position.start.offset || 0,
        node.position.end.offset || 0,
        `heading:${title}`,
      ),
      title,
      level: node.depth || 1,
      anchor: count ? `${base}-${count}` : base,
    });
  });
  return result;
}
function localLink(path: string, href: string): { target?: string; blocked?: boolean } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    return { blocked: true };
  }
  if (
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    /^[a-z]+:/i.test(decoded)
  )
    return { blocked: true };
  const parts = path.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return { blocked: true };
      parts.pop();
    } else parts.push(part);
  }
  const target = parts.join('/');
  return isSafePath(target) ? { target } : { blocked: true };
}
export function resolveDocumentLink(
  path: string,
  href: string,
  files: FileSnapshot,
): Omit<DocumentLink, 'href' | 'line' | 'image'> {
  if (href.startsWith('#')) return { kind: 'anchor', target: path, exists: true };
  if (/^https?:\/\//i.test(href)) return { kind: 'external' };
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return { kind: 'blocked' };
  const result = localLink(path, href);
  if (result.blocked || !result.target) return { kind: 'blocked' };
  return { kind: 'local', target: result.target, exists: Object.hasOwn(files, result.target) };
}
export function markdownLinks(
  tree: MarkdownNode,
  path: string,
  files: FileSnapshot,
): DocumentLink[] {
  const result: DocumentLink[] = [];
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier && node.url)
      definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    if (!['link', 'image', 'linkReference', 'imageReference'].includes(node.type)) return;
    const href = node.url || definitions.get(node.identifier || '');
    if (!href) return;
    result.push({
      href,
      ...resolveDocumentLink(path, href, files),
      line: node.position?.start.line || 1,
      image: node.type.startsWith('image'),
    });
  });
  return result;
}
export function markdownChecks(tree: MarkdownNode, text: string, path: string, revision: string) {
  const result: import('./types').ChecklistItem[] = [];
  function visit(node: MarkdownNode, depth: number) {
    if (node.type === 'listItem' && typeof node.checked === 'boolean' && node.position) {
      const offset = node.position.start.offset || 0;
      const firstLine = text.slice(offset).split(/\r?\n/)[0];
      const marker = /^(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(firstLine);
      if (marker) {
        const start = offset + marker[0].indexOf('[') + 1;
        result.push({
          id: `${path}#check:${start}`,
          text: visibleText(node.children?.[0] || node),
          checked: node.checked,
          depth,
          source: ref(path, revision, text, start, start + 1, `checklist:${start}`),
        });
      }
    }
    node.children?.forEach((child) => visit(child, depth + (node.type === 'listItem' ? 1 : 0)));
  }
  visit(tree, 0);
  return result;
}
export function section(
  text: string,
  headings: Heading[],
  names: RegExp,
): { start: number; end: number; value: string } | undefined {
  const index = headings.findIndex((heading) => names.test(heading.title));
  if (index < 0) return;
  const heading = headings[index];
  let start = text.indexOf('\n', heading.end);
  if (start < 0) start = heading.end;
  else start++;
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  let end = next?.start ?? text.length;
  // Keep surrounding whitespace byte-for-byte outside the editable section.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end, value: text.slice(start, end) };
}
