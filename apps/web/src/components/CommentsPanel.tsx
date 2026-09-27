import { useEffect, useMemo, useState } from 'react';
import { X, MessageSquare, Plus, Check, CornerDownRight } from 'lucide-react';
import {
  addThread,
  mutateThread,
  loadThreads,
  getActor,
  saveActor,
  makeAnchor,
  makeFragmentAnchor,
  resolveAnchor,
  formatMessageDate,
  type Actor,
  type StoredThread,
  type ThreadAction,
} from '../services/comments';
import type { ProjectSnapshot, ProjectStore } from '../services/project-store';
import type { SourceSelection } from './SourceEditor';
import { Dialog } from './Dialog';
import styles from '../App.module.css';

const emojiChoices = ['❤️', '👀', '🎉', '🚀', '💡', '✅', '🤔'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function CommentsPanel({
  store,
  snapshot,
  path,
  source,
  selection,
  documentDirty,
  hidden,
  onClose,
  onRefresh,
  onDirty,
  onJump,
  onBusy,
  resetVersion,
}: {
  store: ProjectStore;
  snapshot: ProjectSnapshot;
  path: string;
  source: string;
  selection: SourceSelection | null;
  documentDirty: boolean;
  hidden: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onJump: (line: number) => void;
  onBusy: (busy: boolean) => void;
  resetVersion: number;
}) {
  const loaded = useMemo(() => loadThreads(snapshot), [snapshot]);
  const threads = loaded.threads.filter((s) => s.thread.anchor.path === path);
  const [selectedId, setSelectedId] = useState(''),
    [draft, setDraft] = useState(''),
    [reply, setReply] = useState(''),
    [editing, setEditing] = useState(''),
    [editedText, setEditedText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [actor, setActor] = useState<Actor>(() => getActor()),
    [actorName, setActorName] = useState(actor.name),
    [emojiFor, setEmojiFor] = useState(''),
    [lineStart, setLineStart] = useState(1),
    [lineEnd, setLineEnd] = useState(1),
    [manualSelection, setManualSelection] = useState<SourceSelection | null>(null),
    [pending, setPending] = useState<(() => void) | null>(null),
    [reanchoring, setReanchoring] = useState(false);
  const selected = threads.find((s) => s.thread.id === selectedId) ?? threads[0];
  const activeSelection = manualSelection;
  const dirty = !!(
    draft ||
    reply ||
    (editing && editedText !== selected?.thread.messages.find((m) => m.id === editing)?.text)
  );
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    setDraft('');
    setReply('');
    setEditing('');
    setEditedText('');
    setManualSelection(null);
    setError('');
  }, [path, resetVersion]);
  useEffect(() => {
    if (selection) setManualSelection(selection);
  }, [selection]);
  const editable = store.mode === 'edit' && !store.recoveryPending;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await action();
      await onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  function requireActor() {
    if (!actor.name) throw new Error('Enter the name to display on your comments.');
    return actor;
  }
  function mutate(stored: StoredThread, action: ThreadAction, after?: () => void) {
    void run(async () => {
      await mutateThread(store, stored, requireActor(), action);
      after?.();
    });
  }
  function guard(action: () => void) {
    if (busy) return;
    if (dirty) {
      setPending(() => action);
      return;
    }
    action();
  }
  function getSelectedAnchor() {
    if (!activeSelection) throw new Error('Select a passage or a line range.');
    if (documentDirty)
      throw new Error(
        'Save the document first, then select the passage again. Your comment is preserved.',
      );
    return makeFragmentAnchor(
      path,
      source,
      snapshot.revisions[path],
      activeSelection.start,
      activeSelection.end,
    );
  }
  function chooseLines() {
    try {
      const anchor = makeAnchor(path, source, snapshot.revisions[path], lineStart, lineEnd);
      const start =
        source
          .split('\n')
          .slice(0, lineStart - 1)
          .join('\n').length + (lineStart > 1 ? 1 : 0);
      setManualSelection({ start, end: start + anchor.quote.length, quote: anchor.quote });
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <aside className={styles.comments} hidden={hidden} aria-label="Document comments">
      <div className={styles.commentsHeader}>
        <h2>
          Comments <span className={styles.muted}>{threads.length}</span>
        </h2>
        <button className="iconButton" aria-label="Close comments" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {!editable && <p className={styles.muted}>Enable Editor mode to write and react.</p>}
      {editable && !actor.name && (
        <div className={styles.reply}>
          <label>
            Your name
            <input
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              maxLength={80}
            />
          </label>
          <button
            onClick={() => {
              try {
                const next = { ...actor, name: actorName.trim() };
                saveActor(next);
                setActor(next);
                setError('');
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Use this name
          </button>
          <p className={styles.muted}>
            Local, self-declared identity; it will be included in comment files.
          </p>
        </div>
      )}
      {loaded.errors.length > 0 && (
        <p role="alert" className={styles.muted}>
          {loaded.errors.length} comment files could not be read. They are preserved unchanged.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className={`${styles.banner} ${styles.bannerError}`}
          style={{ margin: '12px 0' }}
        >
          {error}
          <button onClick={() => void onRefresh()}>Reload conversation</button>
        </div>
      )}
      <div className={styles.threadTabs}>
        {threads.map((stored, i) => (
          <button
            key={stored.thread.id}
            aria-pressed={selected?.thread.id === stored.thread.id}
            onClick={() =>
              guard(() => {
                setSelectedId(stored.thread.id);
                setReply('');
                setEditing('');
                setDraft('');
                setError('');
              })
            }
          >
            T{i + 1} · {stored.thread.status === 'resolved' ? 'Resolved' : 'Open'}
          </button>
        ))}
      </div>
      {selected && (
        <>
          {(() => {
            const resolution = resolveAnchor(
              selected.thread.anchor,
              snapshot.files[path],
              snapshot.revisions[path],
            );
            const labels = {
              exact: 'Passage found',
              moved: 'Passage relocated in this view',
              ambiguous: 'Ambiguous passage',
              outdated: 'The passage is no longer present',
              missing: 'Document unavailable',
            };
            return (
              <>
                <p className={styles.muted}>
                  {labels[resolution.state]}
                  {resolution.startLine ? ` · line ${resolution.startLine}` : ''}
                </p>
                <blockquote className={styles.quote}>{selected.thread.anchor.quote}</blockquote>
                <div className={styles.actions}>
                  {resolution.startLine && (
                    <button onClick={() => onJump(resolution.startLine!)}>
                      <CornerDownRight size={13} />
                      Go to passage
                    </button>
                  )}
                  {editable && (
                    <button disabled={busy} onClick={() => setReanchoring(!reanchoring)}>
                      Reanchor
                    </button>
                  )}
                </div>
              </>
            );
          })()}
          {selected.thread.messages.map((message) => {
            const kinds = [
              'like',
              'dislike',
              ...new Set(
                message.reactions
                  .map((r) => r.kind)
                  .filter((k) => !['like', 'dislike', 'approve', 'disapprove'].includes(k)),
              ),
            ];
            return (
              <section
                className={styles.message}
                key={message.id}
                aria-label={`Message from ${message.author.name}`}
              >
                <div className={styles.messageMeta}>
                  <strong>{message.author.id === actor.id ? 'You' : message.author.name}</strong>
                  <time
                    dateTime={message.createdAt}
                    title={new Date(message.createdAt).toLocaleString('en-GB', {
                      timeZone: 'Europe/Madrid',
                    })}
                  >
                    {formatMessageDate(message.createdAt)}
                  </time>
                  {message.editedAt && (
                    <small
                      title={`Edited ${new Date(message.editedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid' })}`}
                    >
                      edited
                    </small>
                  )}
                </div>
                {editing === message.id ? (
                  <div className={styles.reply}>
                    <label>
                      Edit your reply
                      <textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <div className={styles.actions}>
                      <button
                        className="primary"
                        disabled={busy || !editedText.trim()}
                        onClick={() =>
                          mutate(
                            selected,
                            { type: 'edit', messageId: message.id, text: editedText },
                            () => {
                              setEditing('');
                              setEditedText('');
                            },
                          )
                        }
                      >
                        Save changes
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          guard(() => {
                            setEditing('');
                            setEditedText('');
                          })
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>{message.text}</p>
                )}
                <div className={styles.reactions}>
                  {kinds.map((kind) => {
                    const reactions = message.reactions.filter((r) => r.kind === kind),
                      own = reactions.some((r) => r.actorId === actor.id),
                      emoji = kind === 'like' ? '👍' : kind === 'dislike' ? '👎' : kind;
                    const participants = reactions
                      .map(
                        (r) =>
                          r.actorName ??
                          selected.thread.messages.find((m) => m.author.id === r.actorId)?.author
                            .name ??
                          (r.actorId === actor.id ? actor.name : 'Participant'),
                      )
                      .join(', ');
                    return (
                      <button
                        key={kind}
                        aria-label={`${emoji}: ${reactions.length} reactions`}
                        aria-pressed={own}
                        title={participants || 'No reactions'}
                        disabled={!editable || busy || !actor.name}
                        onClick={() =>
                          mutate(selected, { type: 'react', messageId: message.id, kind })
                        }
                      >
                        {emoji} {reactions.length}
                      </button>
                    );
                  })}
                  <button
                    aria-label={`Add emoji to the message from ${message.author.name}`}
                    disabled={!editable || busy || !actor.name}
                    onClick={() => setEmojiFor(emojiFor === message.id ? '' : message.id)}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {emojiFor === message.id && (
                  <div className={styles.reactions} role="group" aria-label="Choose emoji">
                    {emojiChoices.map((kind) => (
                      <button
                        key={kind}
                        aria-label={`React with ${kind}`}
                        onClick={() => {
                          setEmojiFor('');
                          mutate(selected, { type: 'react', messageId: message.id, kind });
                        }}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                )}
                {editable && message.author.id === actor.id && editing !== message.id && (
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() =>
                      guard(() => {
                        setEditing(message.id);
                        setEditedText(message.text);
                      })
                    }
                  >
                    Edit
                  </button>
                )}
              </section>
            );
          })}
          <div className={styles.commentActions}>
            <button
              disabled={!editable || busy || !actor.name}
              onClick={() =>
                mutate(selected, { type: selected.thread.status === 'open' ? 'resolve' : 'reopen' })
              }
            >
              <Check size={13} />
              {selected.thread.status === 'open' ? 'Resolve' : 'Reopen'}
            </button>
            {selected.thread.status === 'resolved' && (
              <span className={styles.badge} data-status="done">
                Resolved
              </span>
            )}
          </div>
          {editable && (
            <div className={styles.reply}>
              <label>
                Reply
                <textarea
                  placeholder="Write a reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !reply.trim() || !actor.name}
                onClick={() => mutate(selected, { type: 'reply', text: reply }, () => setReply(''))}
              >
                Save reply
              </button>
            </div>
          )}
        </>
      )}
      {!selected && (
        <div className={styles.muted}>
          <MessageSquare size={20} />
          <p>This document has no comments yet.</p>
        </div>
      )}
      {editable && (
        <details className={styles.reply} open={!!activeSelection || reanchoring}>
          <summary>{reanchoring ? 'Choose the new passage' : 'Comment on a passage'}</summary>
          <p className={styles.muted}>
            Select text in the document or enter the physical Markdown line numbers.
          </p>
          <div className={styles.lineSelect}>
            <label>
              From
              <input
                aria-label="Start line"
                type="number"
                min="1"
                value={lineStart}
                onChange={(e) => setLineStart(Number(e.target.value))}
              />
            </label>
            <label>
              To
              <input
                aria-label="End line"
                type="number"
                min={lineStart}
                value={lineEnd}
                onChange={(e) => setLineEnd(Number(e.target.value))}
              />
            </label>
            <button onClick={chooseLines}>Select</button>
          </div>
          {activeSelection && (
            <blockquote className={styles.quote}>{activeSelection.quote}</blockquote>
          )}
          {reanchoring && selected ? (
            <>
              <p className={styles.muted}>
                The original quote will be preserved in the thread history.
              </p>
              <button
                disabled={!activeSelection || documentDirty || busy}
                onClick={() => {
                  try {
                    const anchor = getSelectedAnchor();
                    mutate(selected, { type: 'reanchor', anchor }, () => setReanchoring(false));
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Confirm new passage
              </button>
              <button onClick={() => setReanchoring(false)}>Cancel reanchoring</button>
            </>
          ) : (
            <>
              <label>
                New comment
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write your comment…"
                  disabled={busy}
                />
              </label>
              {documentDirty && (
                <p className={styles.muted}>
                  Save the document and select the passage again before commenting.
                </p>
              )}
              <button
                className="primary"
                disabled={busy || !draft.trim() || !activeSelection || documentDirty || !actor.name}
                onClick={() =>
                  void run(async () => {
                    const anchor = getSelectedAnchor();
                    const thread = await addThread(store, anchor, requireActor(), draft);
                    setSelectedId(thread.id);
                    setDraft('');
                    setManualSelection(null);
                  })
                }
              >
                Save comment
              </button>
            </>
          )}
        </details>
      )}
      {dirty && (
        <p className={styles.muted}>
          Unsaved replies remain only in this tab. Save or copy the text before reloading.
        </p>
      )}
      {busy && (
        <p role="status" className={styles.muted}>
          Saving conversation…
        </p>
      )}
      {pending && (
        <Dialog title="There is an unsaved reply" onClose={() => setPending(null)}>
          <p>Keep or discard the draft before continuing.</p>
          <div className={styles.dialogFooter}>
            <button onClick={() => setPending(null)}>Stay here</button>
            <button
              onClick={() => {
                const action = pending;
                setPending(null);
                setDraft('');
                setReply('');
                setEditing('');
                setEditedText('');
                action();
              }}
            >
              Discard draft and continue
            </button>
          </div>
        </Dialog>
      )}
    </aside>
  );
}
