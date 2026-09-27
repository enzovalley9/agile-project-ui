import { useEffect, useState } from 'react';
import type { ProjectStore, RecoveryStatus } from '../services/project-store';
import type { RecoveryCopy } from '../services/recovery-backups';
import { Dialog } from './Dialog';
import styles from '../App.module.css';

export function RecoveryDialog({
  store,
  status,
  onClose,
  onBusy,
  onRecovered,
}: {
  store: ProjectStore;
  status: RecoveryStatus;
  onClose: () => void;
  onBusy: (value: boolean) => void;
  onRecovered: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(status),
    [copies, setCopies] = useState<RecoveryCopy[] | null>(null),
    [actual, setActual] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [restore, setRestore] = useState<'before' | 'after' | null>(null),
    [exported, setExported] = useState(false),
    [confirmCurrent, setConfirmCurrent] = useState(false);
  const editable = store.mode === 'edit',
    hasExternalChange = reviewed.entries.some((entry) => entry.state === 'changed');
  async function reload() {
    setLoading(true);
    setError('');
    try {
      const current = await store.recoveryStatus();
      if (!current) {
        await onRecovered();
        return;
      }
      setReviewed(current);
      setCopies(await store.recoveryCopies());
      setExported(false);
      setActual(
        Object.fromEntries(
          await Promise.all(
            current.entries.map(
              async (entry) =>
                [
                  entry.path,
                  await store.read(entry.path).catch(() => 'File unavailable for reading.'),
                ] as const,
            ),
          ),
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [store]);
  async function apply(version?: 'before' | 'after') {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (version) await store.restoreRecovery(reviewed, version);
      else await store.reconcileRecovery(reviewed);
      await onRecovered();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onBusy(false);
      setRestore(null);
    }
  }
  function exportCopies() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { schemaVersion: 1, recovery: reviewed, copies, current: actual },
            null,
            2,
          ) + '\n',
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `bmad-recovery-${reviewed.id}.json`;
    link.click();
    setExported(true);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog
      title="Review interrupted save"
      wide={!!copies}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Compare the current files with the original content and planned save. Your drafts remain in
        this tab.
      </p>
      {error && (
        <p role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          {error}
        </p>
      )}
      {loading && <p role="status">Reading copies and current files…</p>}
      {reviewed.corrupt ? (
        <p role="alert">
          The record is unreadable. Keep a copy and review
          .bmad-project-ui/local/write-recovery.json externally before removing it.
        </p>
      ) : (
        <>
          {!loading && !copies && (
            <p role="alert">
              This browser has no verifiable copies. The record retains paths and hashes but cannot
              reconstruct the content. Review the files externally before accepting their state.
            </p>
          )}
          {!loading && copies && !reviewed.backupsPersistent && (
            <p role="alert">
              The copies are only in the memory of this tab. Download them before closing or
              reloading.
            </p>
          )}
          {hasExternalChange && (
            <p role="alert">
              An external version differs. Restoration is blocked to preserve it. Export the copies
              and review the files before accepting the current state.
            </p>
          )}
          {copies && reviewed.backupsPersistent && (
            <p className={styles.muted}>
              Copies verified in private browser storage, outside the repository.
            </p>
          )}
          {reviewed.entries.map((entry) => {
            const copy = copies?.find((copy) => copy.path === entry.path);
            return (
              <section key={entry.path} className={styles.comparisonField}>
                <h3>{entry.path}</h3>
                <p>
                  {entry.state === 'saved'
                    ? 'Planned content saved'
                    : entry.state === 'original'
                      ? 'Original content preserved'
                      : 'Content differs; review required'}
                </p>
                {copy ? (
                  <details>
                    <summary>Compare original, current file, and planned content</summary>
                    <div className={styles.threeWay}>
                      <section>
                        <h4>Original</h4>
                        <pre>{copy.before ?? 'The file did not exist.'}</pre>
                      </section>
                      <section>
                        <h4>Current file</h4>
                        <pre>{actual[entry.path] ?? 'Reading…'}</pre>
                      </section>
                      <section>
                        <h4>Planned content</h4>
                        <pre>{copy.after}</pre>
                      </section>
                    </div>
                  </details>
                ) : (
                  <details>
                    <summary>View recorded hashes</summary>
                    <p className={styles.filePath}>
                      Original: {entry.before ?? 'new file'}
                      <br />
                      Current: {entry.actual ?? 'unavailable'}
                      <br />
                      Planned: {entry.after}
                    </p>
                  </details>
                )}
              </section>
            );
          })}
        </>
      )}
      {!editable && <p>Enable Editor mode to restore or accept the observed state.</p>}
      <div className={styles.actions}>
        <button disabled={busy || loading} onClick={() => void reload()}>
          Check again
        </button>
        {copies && (
          <button disabled={busy || loading} onClick={exportCopies}>
            Export copies
          </button>
        )}
      </div>
      <div className={styles.dialogFooter}>
        {copies && !reviewed.corrupt && (
          <>
            <button
              disabled={
                !editable ||
                busy ||
                loading ||
                hasExternalChange ||
                copies.some((copy) => copy.before === null)
              }
              onClick={() => setRestore('before')}
            >
              Restore originals
            </button>
            <button
              className="primary"
              disabled={!editable || busy || loading || hasExternalChange}
              onClick={() => setRestore('after')}
            >
              Complete planned save
            </button>
          </>
        )}
        <button
          disabled={
            !editable ||
            busy ||
            loading ||
            reviewed.corrupt ||
            (hasExternalChange && !!copies && !exported)
          }
          onClick={() => {
            if (hasExternalChange) setConfirmCurrent(true);
            else void apply();
          }}
        >
          {hasExternalChange ? 'Keep current files' : 'Accept verified state'}
        </button>
      </div>
      {copies?.some((copy) => copy.before === null) && (
        <p className={styles.muted}>
          The plan includes new files. To remove them, export the copies and review them externally.
        </p>
      )}
      <p className={styles.muted}>
        Accepting the state keeps the files as they are and removes the recovery record. Further
        writes are enabled after the hashes are checked again.
      </p>
      {confirmCurrent && (
        <Dialog
          title="Keep the current files"
          onClose={() => {
            if (!busy) setConfirmCurrent(false);
          }}
        >
          <p>
            The current external version will be preserved. The pending record and private recovery
            copies in this browser will be removed. Keep the download and review the differences
            before continuing.
          </p>
          <div className={styles.dialogFooter}>
            <button disabled={busy} onClick={() => setConfirmCurrent(false)}>
              Review again
            </button>
            <button disabled={busy} onClick={() => void apply()}>
              Confirm and keep current state
            </button>
          </div>
        </Dialog>
      )}
      {restore && (
        <Dialog
          title={restore === 'before' ? 'Restore originals' : 'Complete planned save'}
          onClose={() => {
            if (!busy) setRestore(null);
          }}
        >
          <p>
            This will write {reviewed.entries.length} files using{' '}
            {restore === 'before' ? 'the original content' : 'the planned content'} from the
            reviewed copies. Every file will be checked again for changes before saving.
          </p>
          <p>Drafts in this tab are preserved and may require another comparison.</p>
          <div className={styles.dialogFooter}>
            <button disabled={busy} onClick={() => setRestore(null)}>
              Cancel
            </button>
            <button className="primary" disabled={busy} onClick={() => void apply(restore)}>
              {busy ? 'Verifying…' : 'Confirm restoration'}
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
