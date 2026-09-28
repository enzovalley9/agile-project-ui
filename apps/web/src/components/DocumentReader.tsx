import { memo, useCallback, useMemo, useRef, type HTMLAttributes } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { headingAnchor } from '../../../../packages/domain/src/index';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link2, ImageOff } from 'lucide-react';
import type { ProjectStore } from '../services/project-store';
import { MermaidDiagram } from './MermaidDiagram';
import { DocumentImage } from './DocumentImage';
import type { SourceSelection } from './SourceEditor';
import styles from '../App.module.css';

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } };
  data?: Record<string, unknown>;
}
function sourcePositions() {
  return (tree: MarkdownNode) => {
    const counts = new Map<string, number>();
    const visibleText = (node: MarkdownNode): string =>
      node.value ?? node.children?.map(visibleText).join('') ?? '';
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const base = headingAnchor(visibleText(node));
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        node.data = { ...node.data, hProperties: { id: count ? `${base}-${count}` : base } };
      }
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (
          child.type === 'text' &&
          child.position?.start.offset !== undefined &&
          child.position.end.offset !== undefined
        )
          return {
            type: 'sourceText',
            children: [{ type: 'text', value: child.value }],
            data: {
              hName: 'span',
              hProperties: {
                'data-source-start': child.position.start.offset,
                'data-source-end': child.position.end.offset,
                'data-source-line': child.position.start.line,
              },
            },
            position: child.position,
          };
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}
export function resolveDocumentLink(current: string, target: string): string | null {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.startsWith('//') ||
    target.startsWith('/') ||
    target.includes('\\')
  )
    return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    /^[a-z]+:/i.test(decoded)
  )
    return null;
  const parts = current.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}
interface DocumentReaderProps {
  store?: ProjectStore;
  resourceVersion?: object;
  source: string;
  path: string;
  editable: boolean;
  onChange: (source: string) => void;
  onNavigate: (path: string, fragment?: string) => void;
  onSelect: (selection: SourceSelection | null) => void;
  highlightLine?: number;
  onDraftChange?: (dirty: boolean) => void;
}
export function DocumentReader(props: DocumentReaderProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const onChange = useCallback((source: string) => callbacks.current.onChange(source), []),
    onNavigate = useCallback(
      (path: string, fragment?: string) => callbacks.current.onNavigate(path, fragment),
      [],
    ),
    onSelect = useCallback(
      (selection: SourceSelection | null) => callbacks.current.onSelect(selection),
      [],
    ),
    onDraftChange = useCallback((dirty: boolean) => callbacks.current.onDraftChange?.(dirty), []);
  return (
    <DocumentContent
      {...props}
      onChange={onChange}
      onNavigate={onNavigate}
      onSelect={onSelect}
      onDraftChange={onDraftChange}
    />
  );
}
const DocumentContent = memo(function DocumentContent({
  source,
  path,
  editable,
  onChange,
  onNavigate,
  onSelect,
  highlightLine,
  onDraftChange,
  store,
  resourceVersion,
}: DocumentReaderProps) {
  const ref = useRef<HTMLElement>(null);
  const headings = useMemo(() => {
    const tree = unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(remarkGfm)
      .parse(source) as MarkdownNode;
    const result: { id: string; level: number; title: string }[] = [];
    const counts = new Map<string, number>();
    const text = (node: MarkdownNode): string =>
      node.value ?? node.children?.map(text).join('') ?? '';
    const walk = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const title = text(node),
          base = headingAnchor(title),
          count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        result.push({ id: count ? `${base}-${count}` : base, level: node.depth ?? 1, title });
      }
      node.children?.forEach(walk);
    };
    walk(tree);
    return result;
  }, [source]);
  const rendererContext = useRef({
    source,
    path,
    editable,
    onChange,
    onNavigate,
    highlightLine,
    onDraftChange,
    store,
    resourceVersion,
  });
  rendererContext.current = {
    source,
    path,
    editable,
    onChange,
    onNavigate,
    highlightLine,
    onDraftChange,
    store,
    resourceVersion,
  };
  const components = useMemo<Components>(
    () => ({
      pre: ({ node, children }) => {
        const code = node?.children[0];
        if (
          code?.type === 'element' &&
          code.tagName === 'code' &&
          Array.isArray(code.properties.className) &&
          code.properties.className.includes('language-mermaid')
        ) {
          const source = code.children
            .filter((child) => child.type === 'text')
            .map((child) => child.value)
            .join('');
          return <MermaidDiagram source={source} />;
        }
        return <pre>{children}</pre>;
      },
      span: (props) => {
        const { source, editable, onChange, highlightLine, onDraftChange } =
          rendererContext.current;
        const attrs = props as HTMLAttributes<HTMLSpanElement> & {
          'data-source-start'?: number;
          'data-source-end'?: number;
          'data-source-line'?: number;
        };
        const start = Number(attrs['data-source-start']),
          end = Number(attrs['data-source-end']),
          line = Number(attrs['data-source-line']);
        const text =
          typeof props.children === 'string'
            ? props.children
            : Array.isArray(props.children) && props.children.every((x) => typeof x === 'string')
              ? props.children.join('')
              : null;
        const canEdit =
          editable && Number.isFinite(start) && text !== null && source.slice(start, end) === text;
        return (
          <span
            data-source-start={Number.isFinite(start) ? start : undefined}
            data-source-end={Number.isFinite(end) ? end : undefined}
            data-source-line={Number.isFinite(line) ? line : undefined}
            className={highlightLine === line ? styles.highlight : undefined}
            contentEditable={canEdit ? 'plaintext-only' : undefined}
            suppressContentEditableWarning={canEdit}
            aria-label={canEdit ? `Edit text on line ${line}` : undefined}
            role={canEdit ? 'textbox' : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onKeyDown={
              canEdit
                ? (e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }
                : undefined
            }
            onInput={canEdit ? () => onDraftChange?.(true) : undefined}
            onBlur={
              canEdit
                ? (e) => {
                    const next = e.currentTarget.textContent ?? '';
                    if (next !== text) onChange(source.slice(0, start) + next + source.slice(end));
                    onDraftChange?.(false);
                  }
                : undefined
            }
          >
            {props.children}
          </span>
        );
      },
      a: ({ href, children }) => {
        const { path, onNavigate } = rendererContext.current;
        if (!href) return <span>{children}</span>;
        if (href.startsWith('#'))
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(path, href.slice(1));
              }}
            >
              {children}
            </a>
          );
        if (/^https?:\/\//i.test(href))
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
              <Link2 size={11} aria-label="External link" />
            </a>
          );
        const resolved = resolveDocumentLink(path, href);
        return resolved ? (
          <a
            href={`#document/${encodeURIComponent(resolved)}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(resolved, href.split('#')[1]);
            }}
          >
            {children}
          </a>
        ) : (
          <span title="Link outside the authorized scope">{children}</span>
        );
      },
      img: ({ src, alt }) => {
        const { path, store, resourceVersion } = rendererContext.current;
        return (
          <DocumentImage
            src={src}
            alt={alt}
            documentPath={path}
            store={store}
            resourceVersion={resourceVersion}
          />
        );
      },
      input: ({ node: _node, ...props }) => (
        <input {...props} disabled aria-label="Document checkbox" />
      ),
      table: ({ node: _node, ...props }) => (
        <div className={styles.tableScroll}>
          <table {...props} />
        </div>
      ),
    }),
    [],
  );
  function selection() {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !ref.current?.contains(selected.anchorNode)) return;
    const range = selected.getRangeAt(0);
    function endpoint(node: Node, offset: number, atEnd: boolean) {
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      const span = element?.closest<HTMLElement>('[data-source-start]');
      if (!span) return null;
      const sourceStart = Number(span.dataset.sourceStart),
        sourceEnd = Number(span.dataset.sourceEnd);
      if (node.nodeType === Node.TEXT_NODE)
        return source.slice(sourceStart, sourceEnd) === span.textContent
          ? sourceStart + offset
          : null;
      return atEnd ? sourceEnd : sourceStart;
    }
    const start = endpoint(range.startContainer, range.startOffset, false),
      end = endpoint(range.endContainer, range.endOffset, true);
    if (start !== null && end !== null && end > start)
      onSelect({ start, end, quote: source.slice(start, end) });
    else onSelect(null);
  }
  const isMarkdown = /\.(md|mdx)$/i.test(path);
  if (!isMarkdown) return <pre className={styles.rawText}>{source}</pre>;
  return (
    <>
      {headings.length > 0 && (
        <details className={styles.toc}>
          <summary>
            In this document{' '}
            <span>
              {headings.length} {headings.length === 1 ? 'section' : 'sections'}
            </span>
          </summary>
          <nav aria-label="Document contents">
            {headings.map((h) => (
              <a key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }} href={`#${h.id}`}>
                {h.title}
              </a>
            ))}
          </nav>
        </details>
      )}
      {editable && (
        <p className={styles.editorHint}>
          Edit the text directly. Open Markdown to add structure or change formatting. Save when
          finished.
        </p>
      )}
      <article
        ref={ref}
        className={styles.document}
        onMouseUp={selection}
        onKeyUp={selection}
        aria-label="Document content"
      >
        <ReactMarkdown
          remarkPlugins={[remarkFrontmatter, remarkGfm, sourcePositions]}
          components={components}
          skipHtml
        >
          {source}
        </ReactMarkdown>
      </article>
    </>
  );
});
