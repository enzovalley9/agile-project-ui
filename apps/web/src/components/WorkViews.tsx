import { useEffect, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resolveDocumentLink } from './DocumentReader';
import { Inbox, ListChecks, Circle, CircleCheck, ArrowUpRight, GripVertical } from 'lucide-react';
import {
  planWorkItemEdit,
  visibleWorkItems,
  type WorkItem,
  type ProjectIndex,
  type FileChange,
} from '../../../../packages/domain/src/index';
import type { ProjectSnapshot, ProjectStore } from '../services/project-store';
import { Dialog } from './Dialog';
import styles from '../App.module.css';

const labels: Record<string, string> = {
  backlog: 'Backlog',
  'ready-for-dev': 'Ready',
  'in-progress': 'In progress',
  review: 'In review',
  done: 'Done',
  todo: 'To do',
  draft: 'Draft',
  blocked: 'Blocked',
  built: 'Built',
  cancelled: 'Cancelled',
  open: 'Open',
  optional: 'Optional',
};
export const statusLabel = (status: string) => labels[status] ?? status;

export function WorkChecklistList({
  items,
  onOpen,
  title = 'Stories and tasks',
}: {
  items: WorkItem[];
  onOpen: (item: WorkItem) => void;
  title?: string;
}) {
  const tasks = items.flatMap((item) => item.checklist);
  return (
    <section className={styles.workChecklist} aria-label={title}>
      <div className={styles.taskListHeading}>
        <h2>
          <ListChecks size={18} />
          {title}
        </h2>
        <span className={styles.muted}>
          {items.length} stories · {tasks.filter((task) => task.checked).length}/{tasks.length}{' '}
          tasks complete
        </span>
      </div>
      {!items.length ? (
        <p className={styles.muted}>No related stories are declared in the project files.</p>
      ) : (
        <ul className={styles.storyList}>
          {items.map((item) => (
            <li key={item.id}>
              <details open className={styles.storyTasks}>
                <summary>
                  <span
                    className={styles.taskStatusDot}
                    data-status={item.status?.valid ? item.status.raw : 'unknown'}
                    aria-hidden="true"
                  />
                  <span className={styles.taskStoryTitle}>
                    {item.nativeId && <small>{item.nativeId}</small>}
                    {item.title}
                  </span>
                  <span
                    className={styles.badge}
                    data-status={item.status?.valid ? item.status.raw : 'unknown'}
                  >
                    {item.status ? statusLabel(item.status.raw) : 'No declared status'}
                  </span>
                </summary>
                <div className={styles.taskListBody}>
                  {item.checklist.length ? (
                    <ul className={styles.checklistItems}>
                      {item.checklist.map((task) => (
                        <li key={task.id} style={{ paddingInlineStart: task.depth * 14 }}>
                          <span
                            className={styles.taskCheck}
                            role="img"
                            data-checked={task.checked}
                            aria-label={task.checked ? 'Complete' : 'Incomplete'}
                          >
                            {task.checked ? <CircleCheck size={16} /> : <Circle size={16} />}
                          </span>
                          <span>{task.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.muted}>No checklist is declared for this story.</p>
                  )}
                  <button className="link" onClick={() => onOpen(item)}>
                    Open story <ArrowUpRight size={13} />
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type BoardProps = {
  snapshot: ProjectSnapshot;
  store: ProjectStore;
  onOpen: (item: WorkItem) => void;
  onRefresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  blocked?: boolean;
  scope?: 'stories' | 'sprint';
};
export function StoryBoard({
  snapshot,
  store,
  onOpen,
  onRefresh,
  onBusy,
  blocked = false,
  scope = 'stories',
}: BoardProps) {
  const index = snapshot.index;
  const [query, setQuery] = useState(''),
    [epic, setEpic] = useState(''),
    [kind, setKind] = useState('story');
  const [dragging, setDragging] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null);
  const [move, setMove] = useState<{
    item: WorkItem;
    target: string;
    changes: FileChange[];
    warnings: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [announcement, setAnnouncement] = useState('');
  const projected = visibleWorkItems(index),
    epics = projected.filter((item) => item.kind === 'epic');
  const all = projected.filter(
    (item) =>
      item.kind === (scope === 'sprint' ? 'story' : kind) &&
      (scope !== 'sprint' || item.status?.role === 'sprint'),
  );
  const items = all.filter(
    (item) =>
      (!epic || item.epicId === epic) &&
      `${item.title} ${item.nativeId ?? item.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const statuses = all.reduce<string[]>((values, item) => {
    for (const status of item.status?.allowed ?? [])
      if (!values.includes(status)) values.push(status);
    return values;
  }, []);
  const known = items.filter((item) => item.status?.valid && statuses.includes(item.status.raw)),
    unknown = items.filter((item) => !known.includes(item));
  const canMove = (item: WorkItem) =>
    store.mode === 'edit' &&
    !blocked &&
    !busy &&
    !store.recoveryPending &&
    item.editable.status &&
    !!item.status?.allowed.length;
  const dragged = items.find((item) => item.id === dragging);
  function reviewMove(item: WorkItem, target: string) {
    if (!canMove(item) || target === item.status?.raw || !item.status?.allowed.includes(target))
      return;
    try {
      const plan = planWorkItemEdit(index, snapshot.files, {
        id: item.id,
        field: 'status',
        value: target,
      });
      setMove({ item, target, ...plan });
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function saveMove() {
    if (!move || !canMove(move.item)) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await store.applyChanges(move.changes);
      await onRefresh();
      setAnnouncement(
        `${move.item.title} moved to ${statusLabel(move.target)}. Saved and verified.`,
      );
      setMove(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const card = (item: WorkItem) => {
    const parent = epics.find((epic) => epic.id === item.epicId || epic.nativeId === item.epicId);
    return (
      <article
        className={styles.card}
        key={item.id}
        draggable={canMove(item)}
        data-dragging={dragging === item.id || undefined}
        data-status={item.status?.raw}
        onDragStart={(event) => {
          if (!canMove(item)) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData('application/x-bmad-work-item', item.id);
          event.dataTransfer.effectAllowed = 'move';
          setDragging(item.id);
          setAnnouncement(`Moving ${item.title}. Drop in a declared state to review the change.`);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
          setAnnouncement('');
        }}
      >
        <button className={styles.cardContent} onClick={() => onOpen(item)}>
          <span className={styles.cardTitle}>{item.title}</span>
          <span className={styles.cardId}>{item.nativeId ?? item.id}</span>
          <span className={styles.cardEpic}>
            {item.epicId
              ? `Epic ${parent?.nativeId ?? item.epicId} · ${parent?.title ?? 'Declared relationship'}`
              : 'No declared epic'}
          </span>
        </button>
        <div className={styles.cardFooter}>
          {item.checklist.length > 0 && (
            <span>
              <ListChecks size={13} />
              {item.checklist.filter((task) => task.checked).length}/{item.checklist.length}
            </span>
          )}
          {canMove(item) && (
            <button
              className={styles.moveButton}
              aria-label={`Move ${item.title}`}
              title="Drag to a state, or choose a state with this button"
              onClick={() =>
                reviewMove(
                  item,
                  item.status!.allowed.find((status) => status !== item.status!.raw)!,
                )
              }
            >
              <GripVertical size={14} />
              <span>Move</span>
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className={styles.content}>
      <div className={styles.contentTitle}>
        <div>
          <p className={styles.eyebrow}>
            {scope === 'sprint' ? 'Sprint tracking' : 'Project work'}
          </p>
          <h1>{scope === 'sprint' ? 'Sprint' : 'Stories'}</h1>
          <p className={styles.muted}>
            {items.length} items · states read from project files
            {store.mode === 'edit' ? ' · drag to move, or use the Move button' : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <input
            aria-label="Search stories"
            placeholder="Search stories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {scope !== 'sprint' && (
            <select
              aria-label="Work type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="story">Stories</option>
              <option value="build">Builds</option>
              <option value="action">Actions</option>
              <option value="retrospective">Retrospectives</option>
            </select>
          )}
          <select
            aria-label="Filter by epic"
            value={epic}
            onChange={(event) => setEpic(event.target.value)}
          >
            <option value="">All epics</option>
            {epics.map((item) => (
              <option key={item.id} value={item.nativeId ?? item.id}>
                {item.nativeId ?? item.id} · {item.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" aria-live="polite" className={styles.boardAnnouncement}>
        {announcement}
      </p>
      {error && !move && (
        <p role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          {error}
        </p>
      )}
      {statuses.length > 0 && (
        <div
          className={styles.board}
          style={{ '--board-columns': Math.min(statuses.length, 5) } as CSSProperties}
        >
          {statuses.map((status) => (
            <section
              className={styles.column}
              key={status}
              aria-label={statusLabel(status)}
              data-status={status}
              data-drop-active={over === status || undefined}
              data-drop-allowed={
                (!!dragged &&
                  canMove(dragged) &&
                  dragged.status?.allowed.includes(status) &&
                  dragged.status?.raw !== status) ||
                undefined
              }
              onDragOver={(event) => {
                if (
                  dragged &&
                  canMove(dragged) &&
                  dragged.status?.allowed.includes(status) &&
                  dragged.status.raw !== status
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOver(status);
                }
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (
                  dragged &&
                  event.dataTransfer.getData('application/x-bmad-work-item') === dragged.id
                )
                  reviewMove(dragged, status);
                setDragging(null);
                setOver(null);
              }}
            >
              <div className={styles.columnHeader}>
                <span className={styles.columnDot} aria-hidden="true" />
                {statusLabel(status)}
                <span>{known.filter((item) => item.status?.raw === status).length}</span>
              </div>
              {known.filter((item) => item.status?.raw === status).map(card)}
              {!known.some((item) => item.status?.raw === status) && (
                <p className={styles.emptyColumn}>
                  No items in {statusLabel(status).toLowerCase()}.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
      {unknown.length > 0 && (
        <section className={styles.unclassified}>
          <h2>Unclassified</h2>
          <p className={styles.muted}>Original values are preserved; a state is never guessed.</p>
          <div>
            {unknown.map((item) => (
              <div key={item.id}>
                <span className={styles.badge} data-status="unknown">
                  {item.status?.raw ?? 'No declared status'}
                </span>
                {card(item)}
              </div>
            ))}
          </div>
        </section>
      )}
      {!items.length && (
        <div className={styles.empty}>
          <Inbox size={30} />
          <h2>No {kind === 'story' ? 'stories' : 'items'} available</h2>
          <p>Check the filters or review the project documents and diagnostics.</p>
        </div>
      )}
      {scope === 'sprint' && (
        <WorkChecklistList items={items} onOpen={onOpen} title="Sprint stories and tasks" />
      )}
      {move && (
        <Dialog
          title="Move story"
          onClose={() => {
            if (!busy) {
              setMove(null);
              setError('');
            }
          }}
          wide
        >
          {error && (
            <p role="alert" className={`${styles.banner} ${styles.bannerError}`}>
              {error}
            </p>
          )}
          <h2>{move.item.title}</h2>
          <p>
            {statusLabel(move.item.status?.raw ?? 'unknown')} →{' '}
            <strong>{statusLabel(move.target)}</strong>
          </p>
          <label>
            Destination state
            <select
              disabled={busy}
              value={move.target}
              onChange={(event) => reviewMove(move.item, event.target.value)}
            >
              {move.item.status?.allowed
                .filter((status) => status !== move.item.status?.raw)
                .map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
            </select>
          </label>
          <p className={styles.muted}>
            Review the original files before saving. Commit and push remain separate actions.
          </p>
          {move.warnings.map((warning) => (
            <p key={warning} className={styles.banner}>
              {warning}
            </p>
          ))}
          {move.changes.map((change) => (
            <details key={change.path} open>
              <summary>
                <code>{change.path}</code>
              </summary>
              <div className={styles.diff}>
                <section>
                  <h3>Current file</h3>
                  <pre>{change.before}</pre>
                </section>
                <section>
                  <h3>After saving</h3>
                  <pre>{change.after}</pre>
                </section>
              </div>
            </details>
          ))}
          <div className={styles.dialogFooter}>
            <button
              disabled={busy}
              onClick={() => {
                setMove(null);
                setError('');
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || blocked || store.recoveryPending || !move.changes.length}
              onClick={() => void saveMove()}
            >
              {busy ? 'Saving…' : 'Confirm move'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
export function StoryDescription({
  text,
  path,
  onNavigate,
}: {
  text: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className={styles.storyDescription}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => {
            if (href && /^https?:\/\//i.test(href))
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            const local = href ? resolveDocumentLink(path, href) : null;
            return local ? (
              <button className="link" onClick={() => onNavigate(local)}>
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
          input: ({ node: _node, ...props }) => (
            <input {...props} disabled aria-label="Document criterion" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className={styles.tableScroll}>
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export function StoryDialog({
  item,
  snapshot,
  store,
  onClose,
  onNavigate,
  onRefresh,
  onBusy,
  onOpenItem,
}: {
  item: WorkItem;
  snapshot: ProjectSnapshot;
  store: ProjectStore;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onOpenItem: (item: WorkItem) => void;
}) {
  const [editing, setEditing] = useState(false),
    [field, setField] = useState<'title' | 'description' | 'status'>(
      item.editable.title ? 'title' : item.editable.description ? 'description' : 'status',
    ),
    [value, setValue] = useState(
      item.editable.title
        ? item.title
        : item.editable.description
          ? (item.description ?? '')
          : (item.status?.raw ?? ''),
    ),
    [changes, setChanges] = useState<FileChange[] | null>(null),
    [warnings, setWarnings] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [exitAction, setExitAction] = useState<(() => void) | null>(null);
  const original =
    field === 'title'
      ? item.title
      : field === 'description'
        ? (item.description ?? '')
        : (item.status?.raw ?? '');
  const hasUnsavedEdit = !!changes || value !== original;
  useEffect(() => {
    if (!hasUnsavedEdit) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedEdit]);
  function requestExit(action: () => void) {
    if (busy) return;
    if (hasUnsavedEdit) {
      setExitAction(() => action);
      return;
    }
    action();
  }
  const epic = snapshot.index.workItems.find(
    (e) => e.id === item.epicId || e.nativeId === item.epicId,
  );
  function plan(
    nextField: 'title' | 'description' | 'status' | 'checklist',
    nextValue: string | boolean,
    checklistId?: string,
  ) {
    try {
      const result = planWorkItemEdit(snapshot.index, snapshot.files, {
        id: item.id,
        field: nextField,
        value: nextValue,
        checklistId,
      });
      setChanges(result.changes);
      setWarnings(result.warnings);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function save() {
    if (!changes || store.recoveryPending) return;
    setBusy(true);
    onBusy(true);
    try {
      await store.applyChanges(changes);
      await onRefresh();
      setChanges(null);
      setEditing(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Dialog title={item.nativeId ?? item.id} onClose={() => requestExit(onClose)} wide={!!changes}>
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          {error}
        </div>
      )}
      {changes ? (
        <>
          <h2>Review changes before saving</h2>
          {changes.map((change) => (
            <section key={change.path}>
              <code>{change.path}</code>
              <div className={styles.diff}>
                <section>
                  <h3>Current file</h3>
                  <pre>{change.before}</pre>
                </section>
                <section>
                  <h3>After saving</h3>
                  <pre>{change.after}</pre>
                </section>
              </div>
            </section>
          ))}
          {warnings.map((w) => (
            <p key={w} className={styles.muted}>
              {w}
            </p>
          ))}
          <div className={styles.dialogFooter}>
            <button disabled={busy} onClick={() => setChanges(null)}>
              Back
            </button>
            <button
              className="primary"
              disabled={busy || !changes.length || store.recoveryPending}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Confirm and save'}
            </button>
          </div>
        </>
      ) : (
        <>
          <span
            className={styles.badge}
            data-status={item.status?.valid ? item.status.raw : 'unknown'}
          >
            {item.status ? statusLabel(item.status.raw) : 'No declared status'}
          </span>
          <h1 className={styles.storyTitle}>{item.title}</h1>
          {item.epicId && (
            <details className={styles.storyEpic}>
              <summary>
                Epic {epic?.nativeId ?? item.epicId} · {epic?.title ?? 'Declared relationship'}
              </summary>
              {epic?.description && <p>{epic.description}</p>}
            </details>
          )}
          {item.description && (
            <section>
              <h2>Description</h2>
              <StoryDescription
                text={item.description}
                path={item.fields.description?.source.path ?? item.source.path}
                onNavigate={(path) => requestExit(() => onNavigate(path))}
              />
            </section>
          )}
          {item.kind === 'epic' && (
            <WorkChecklistList
              items={visibleWorkItems(snapshot.index).filter(
                (story) =>
                  story.kind === 'story' &&
                  (story.epicId === item.id || story.epicId === item.nativeId),
              )}
              onOpen={(story) => requestExit(() => onOpenItem(story))}
            />
          )}
          {item.checklist.length > 0 && (
            <section>
              <h2>
                <ListChecks size={17} /> Tasks and criteria
              </h2>
              {item.checklist.map((task) => (
                <label
                  key={task.id}
                  className={styles.checkboxRow}
                  style={{ marginLeft: task.depth * 12 }}
                >
                  <input
                    type="checkbox"
                    checked={task.checked}
                    disabled={store.mode !== 'edit' || store.recoveryPending}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      requestExit(() => plan('checklist', checked, task.id));
                    }}
                  />
                  {task.text}
                </label>
              ))}
            </section>
          )}
          {item.relatedStatuses.map((status, i) => (
            <p className={styles.muted} key={i}>
              {status.role}: <strong>{status.raw}</strong> · {status.source.path}
            </p>
          ))}
          {item.warnings.map((w) => (
            <p key={w} className={styles.muted}>
              {w}
            </p>
          ))}
          <details className={styles.provenance}>
            <summary>Provenance</summary>
            <p>Entity</p>
            <code>
              {item.source.path} · lines {item.source.lineStart}–{item.source.lineEnd}
            </code>
            {item.fields.description && (
              <>
                <p>Description</p>
                <code>
                  {item.fields.description.source.path} · lines{' '}
                  {item.fields.description.source.lineStart}–
                  {item.fields.description.source.lineEnd}
                </code>
              </>
            )}
            {item.status && (
              <>
                <p>Status: {item.status.role}</p>
                <code>
                  {item.status.source.path} · {item.status.source.locator}
                </code>
              </>
            )}
          </details>
          <div className={styles.actions}>
            <button
              onClick={() => requestExit(() => onNavigate(item.documentPath ?? item.source.path))}
            >
              Open source document
            </button>
            {store.mode === 'edit' && Object.values(item.editable).some(Boolean) && (
              <button disabled={store.recoveryPending} onClick={() => setEditing(!editing)}>
                Edit fields
              </button>
            )}
          </div>
          {editing && (
            <div className={styles.form}>
              <label>
                Field
                <select
                  value={field}
                  onChange={(e) => {
                    const f = e.target.value as typeof field;
                    if (f === field) return;
                    requestExit(() => {
                      setField(f);
                      setValue(
                        f === 'title'
                          ? item.title
                          : f === 'description'
                            ? (item.description ?? '')
                            : (item.status?.raw ?? ''),
                      );
                    });
                  }}
                >
                  {item.editable.title && <option value="title">Title</option>}
                  {item.editable.description && <option value="description">Description</option>}
                  {item.editable.status && <option value="status">Status</option>}
                </select>
              </label>
              <label>
                New value
                {field === 'status' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {item.status?.allowed.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea value={value} onChange={(e) => setValue(e.target.value)} />
                )}
              </label>
              <p className={styles.muted}>The identifier and file name will remain unchanged.</p>
              <button
                className="primary"
                disabled={store.recoveryPending}
                onClick={() => plan(field, value)}
              >
                Review changes
              </button>
            </div>
          )}
        </>
      )}
      {exitAction && (
        <Dialog title="Unsaved edit" onClose={() => setExitAction(null)}>
          <p>Keep this story change or discard it before leaving.</p>
          <div className={styles.dialogFooter}>
            <button onClick={() => setExitAction(null)}>Stay here</button>
            <button
              onClick={() => {
                const action = exitAction;
                setExitAction(null);
                setValue(original);
                setChanges(null);
                setError('');
                action();
              }}
            >
              Discard edit and continue
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
