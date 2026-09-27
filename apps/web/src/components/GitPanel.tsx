import { useEffect, useRef, useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  Upload,
  RefreshCw,
  Plug,
  Unplug,
  Download,
  CircleCheck,
} from 'lucide-react';
import {
  GitClient,
  ConnectorError,
  definitiveRejection,
  type GitRepository,
  type GitPlan,
  type GitOperation,
  type GitBranch as Branch,
  type MutationContext,
} from '../services/git-client';
import type { ProjectStore } from '../services/project-store';
import { Dialog } from './Dialog';
import { ConnectorSetupGuide } from './ConnectorSetupGuide';
import styles from '../App.module.css';

type Phase =
  | 'idle'
  | 'checking'
  | 'permission'
  | 'linking'
  | 'connected'
  | 'disconnected'
  | 'update'
  | 'gitmissing'
  | 'attention';
const label: Record<Phase, string> = {
  idle: 'Not connected',
  checking: 'Checking…',
  permission: 'Permission pending',
  linking: 'Binding project…',
  connected: 'Connected',
  disconnected: 'Connection lost',
  update: 'Update required',
  gitmissing: 'Git unavailable',
  attention: 'Needs attention',
};
const explain = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function GitPanel({
  store,
  hidden,
  context,
  onStatus,
  onBusy,
  onRefresh,
}: {
  store: ProjectStore;
  hidden: boolean;
  context: MutationContext;
  onStatus: (state: string) => void;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [client, setClient] = useState<GitClient | null>(null),
    [phase, setPhase] = useState<Phase>('idle'),
    [endpoint, setEndpoint] = useState('http://127.0.0.1:43120'),
    [token, setToken] = useState(''),
    [trusted, setTrusted] = useState(false),
    [repository, setRepository] = useState<GitRepository | null>(null),
    [branches, setBranches] = useState<Branch[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [branch, setBranch] = useState(''),
    [remote, setRemote] = useState(''),
    [plan, setPlan] = useState<GitPlan | null>(null),
    [operation, setOperation] = useState<GitOperation | null>(null),
    [lostPlan, setLostPlan] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [hint, setHint] = useState(''),
    [guide, setGuide] = useState(false);
  const contextRef = useRef(context);
  contextRef.current = context;
  const generation = useRef(0);
  useEffect(() => onStatus(label[phase]), [phase, onStatus]);
  useEffect(() => {
    setClient(null);
    setPhase('idle');
    setRepository(null);
    setPlan(null);
    setOperation(null);
    setLostPlan('');
    setSelected([]);
    setToken('');
    setTrusted(false);
    generation.current++;
  }, [store]);
  const recovery =
    !!lostPlan || operation?.status === 'uncertain' || operation?.status === 'running';
  const mutationContext = () => ({
    ...contextRef.current,
    recoveryPending: contextRef.current.recoveryPending || recovery,
  });
  function fail(error: unknown) {
    setError(explain(error));
    const code = error instanceof ConnectorError ? error.code : '';
    if (code === 'unreachable') setPhase(client?.connected ? 'disconnected' : 'idle');
    else if (/GIT_NOT|GIT_MISSING|gitmissing/.test(code)) setPhase('gitmissing');
    else if (/AUTH|ORIGIN|TRUST|permission/.test(code)) setPhase('permission');
    else if (/VERSION|PROTOCOL|CONNECTOR_PRODUCT/.test(code)) setPhase('update');
    else setPhase(client?.connected ? 'attention' : 'idle');
  }
  async function run(action: () => Promise<void>, mutation = false) {
    setBusy(true);
    setError('');
    setHint('');
    if (mutation) onBusy(true);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (mutation) onBusy(false);
    }
  }
  async function reload(active = client) {
    if (!active) return;
    const [repo, list] = await Promise.all([active.repository(), active.branches()]);
    setRepository(repo);
    setBranches(list.branches);
    setBranch(repo.branch ?? '');
    setRemote((current) =>
      repo.remotes.some((r) => r.name === current) ? current : (repo.remotes[0]?.name ?? ''),
    );
    setSelected((paths) => paths.filter((path) => repo.changes.some((c) => c.path === path)));
    setPhase('connected');
  }
  async function connect() {
    await run(async () => {
      const current = ++generation.current;
      const active = new GitClient(endpoint);
      setPhase('checking');
      await active.health();
      if (current !== generation.current) return;
      setPhase('linking');
      const repo = await active.connect(store, token, trusted);
      if (current !== generation.current) {
        await active.disconnect();
        return;
      }
      setClient(active);
      setRepository(repo);
      setToken('');
      await reload(active);
      const pending = await active.pendingOperations();
      setOperation(
        pending.operations.find((op) => op.status === 'running' || op.status === 'uncertain') ??
          null,
      );
      await onRefresh();
    }, true);
  }
  async function disconnect() {
    await run(async () => {
      generation.current++;
      await client?.disconnect();
      setClient(null);
      setRepository(null);
      setPhase('idle');
      setToken('');
      setPlan(null);
    });
  }
  async function review(kind: 'commit' | 'branch' | 'push') {
    if (!client) return;
    await run(async () => {
      setOperation(null);
      const context = mutationContext();
      setPlan(
        kind === 'commit'
          ? await client.planCommit(selected, message, context)
          : kind === 'branch'
            ? await client.planBranch(branch, context)
            : await client.planPush(remote, branch, context),
      );
    });
  }
  async function execute() {
    if (!client || !plan) return;
    const reviewed = plan;
    setPlan(null);
    await run(async () => {
      let receivedResult = false;
      try {
        const result = await client.execute(reviewed.id, mutationContext());
        receivedResult = true;
        setOperation(result);
        setLostPlan('');
        if (result.status === 'verified') {
          await reload();
          await onRefresh();
          if (reviewed.kind === 'commit') {
            setMessage('');
            setSelected([]);
          }
        } else setPhase('attention');
      } catch (e) {
        if (receivedResult) client.requireRecovery();
        setLostPlan(!receivedResult && definitiveRejection(e) ? '' : reviewed.id);
        setPhase('attention');
        throw e;
      }
    }, true);
  }
  async function reconcile() {
    if (!client) return;
    await run(async () => {
      const planId = operation?.planId || lostPlan;
      try {
        const result = operation
          ? await client.reconcile(operation.id)
          : lostPlan
            ? await client.operationByPlan(lostPlan)
            : null;
        if (!result)
          throw new Error(
            'The connector has no result for this plan yet. The operation still needs verification.',
          );
        setOperation(result);
        if (result.status === 'verified') {
          await reload();
          await onRefresh();
        }
        setLostPlan('');
      } catch (error) {
        client.requireRecovery();
        setLostPlan(planId);
        throw error;
      }
    }, true);
  }
  const blocked =
    !!repository?.conflicts.length ||
    !!repository?.operationInProgress.length ||
    store.mode !== 'edit' ||
    busy ||
    recovery ||
    context.saving ||
    context.recoveryPending ||
    context.drafts > 0 ||
    !client?.connected;
  const changeForm = (action: () => void) => {
    setPlan(null);
    action();
  };
  return (
    <main hidden={hidden} className={`${styles.content} ${styles.connectionPage}`}>
      <div className={styles.contentTitle}>
        <div>
          <h1>Git connection</h1>
          <p className={styles.muted}>Branches, commits, and pushes using Git on your computer.</p>
        </div>
        <span
          className={styles.badge}
          data-status={
            phase === 'connected'
              ? 'done'
              : ['idle', 'checking', 'linking'].includes(phase)
                ? 'backlog'
                : 'unknown'
          }
        >
          {label[phase]}
        </span>
      </div>
      {client?.healthInfo && (
        <p className={styles.muted} role="status">
          Installed connector {client.healthInfo.version} · protocol {client.healthInfo.protocol}.
          <button onClick={() => setGuide(true)}>Update or roll back</button>
        </p>
      )}
      {error && (
        <div
          role="alert"
          className={`${styles.banner} ${styles.bannerError}`}
          style={{ margin: '16px 0' }}
        >
          {error}
        </div>
      )}
      {hint && (
        <p
          role="status"
          className={`${styles.banner} ${styles.bannerInfo}`}
          style={{ margin: '16px 0' }}
        >
          {hint}
        </p>
      )}
      {(!client || !repository) && (
        <>
          <p>
            Reading, editing, and comments use folder permission. The connector adds Git operations
            for this repository.
          </p>
          <div className={styles.actions}>
            <button onClick={() => setGuide(true)}>
              <Download size={16} />
              Install Git connector
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPhase('checking');
                  const probe = new GitClient(endpoint);
                  const health = await probe.health();
                  setPhase('permission');
                  setHint(
                    `Connector ${health.version} is available. Enter the session key and bind this folder.`,
                  );
                })
              }
            >
              Already installed / Check
            </button>
          </div>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <label>
              Local connector address
              <input
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
            </label>
            <label>
              Connector session key
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <label>
              Load session file
              <input
                type="file"
                aria-label="Load session file"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  if (file.size > 4096) {
                    setError('The session file size is invalid.');
                    return;
                  }
                  void file
                    .text()
                    .then((value) => {
                      setToken(value.trim());
                      setError('');
                    })
                    .catch(() => setError('The session file could not be read.'));
                }}
              />
            </label>
            <p className={styles.muted}>
              The key stays only in this tab. Git and the system continue to handle remote
              authentication.
            </p>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
                disabled={busy}
              />
              I trust the hooks, filters, and credential helpers in this repository.
            </label>
            {store.mode !== 'edit' && (
              <p className={styles.muted}>
                Enable Editor mode to verify that both applications open the same folder. A
                temporary marker will be written and removed.
              </p>
            )}
            <div className={styles.actions}>
              <button
                className="primary"
                disabled={busy || !token || !trusted || store.mode !== 'edit'}
                type="submit"
              >
                <Plug size={16} />
                {busy ? 'Checking…' : 'Connect and bind project'}
              </button>
              {busy && phase === 'checking' && (
                <button
                  type="button"
                  onClick={() => {
                    generation.current++;
                    setPhase('idle');
                    setBusy(false);
                    onBusy(false);
                  }}
                >
                  Cancel check
                </button>
              )}
            </div>
          </form>
        </>
      )}
      {repository && client && (
        <>
          <section className={styles.listItem}>
            <div className={styles.contentTitle}>
              <div>
                <h2>{repository.rootName}</h2>
                <p className={styles.muted}>
                  Branch {repository.branch ?? 'Detached HEAD'} ·{' '}
                  {repository.head?.slice(0, 12) ?? 'No commits'}
                </p>
              </div>
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => void run(() => reload())}>
                  <RefreshCw size={15} />
                  Check
                </button>
                <button disabled={busy || recovery} onClick={() => void disconnect()}>
                  <Unplug size={15} />
                  Disconnect
                </button>
              </div>
            </div>
            {repository.conflicts.length > 0 && (
              <p role="alert">
                Conflicts found: {repository.conflicts.join(', ')}. Resolve them with Git and check
                again.
              </p>
            )}
            {repository.operationInProgress.length > 0 && (
              <p role="alert">
                Git has a pending operation: {repository.operationInProgress.join(', ')}.
              </p>
            )}
          </section>
          {recovery && (
            <div className={styles.banner} role="alert" style={{ margin: '16px 0' }}>
              <strong>Result awaiting verification</strong>
              <p>The operation may have been applied. Check the result before repeating it.</p>
              <button disabled={busy} onClick={() => void reconcile()}>
                Check result
              </button>
              {lostPlan && <p className={styles.muted}>Plan {lostPlan}</p>}
            </div>
          )}
          {operation && (
            <div
              role="status"
              className={`${styles.banner} ${operation.status === 'verified' ? styles.bannerSuccess : ''}`}
              style={{ margin: '16px 0' }}
            >
              <strong>
                {operation.status === 'verified'
                  ? 'Verified result'
                  : operation.status === 'rejected'
                    ? 'Operation rejected'
                    : operation.status === 'running'
                      ? 'Operation in progress'
                      : 'Unconfirmed result'}
              </strong>
              {operation.head && <p>Commit {operation.head}</p>}
              {operation.remoteSha && <p>Remote revision {operation.remoteSha}</p>}
              {operation.error && <p>{operation.error.message}</p>}
              {operation.warning && <p>{operation.warning}</p>}
            </div>
          )}
          <h2>Local changes</h2>
          <p className={styles.muted}>
            Select the files for the commit. Saving documents and creating a commit are separate
            actions.
          </p>
          {repository.staged.length > 0 && (
            <div className={styles.banner} style={{ margin: '12px 0' }}>
              There are {repository.staged.length} files in the Git index. Commit or unstage them in
              your Git client before creating another commit here.
            </div>
          )}
          <div className={styles.list}>
            {repository.changes.map((change) => (
              <label className={`${styles.listItem} ${styles.checkboxRow}`} key={change.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(change.path)}
                  disabled={blocked}
                  onChange={(e) =>
                    changeForm(() =>
                      setSelected((paths) =>
                        e.target.checked
                          ? [...paths, change.path]
                          : paths.filter((p) => p !== change.path),
                      ),
                    )
                  }
                />
                <code>
                  {change.index}
                  {change.workingTree}
                </code>
                <span>
                  {change.originalPath ? `${change.originalPath} → ` : ''}
                  {change.path}
                </span>
              </label>
            ))}
          </div>
          {!repository.changes.length && (
            <p className={styles.muted}>
              <CircleCheck size={15} /> The working tree has no changes.
            </p>
          )}
          <div className={styles.form}>
            <label>
              Commit message
              <textarea
                value={message}
                onChange={(e) => changeForm(() => setMessage(e.target.value))}
                disabled={blocked}
                placeholder="Describe the change"
              />
            </label>
            <div>
              <button
                disabled={
                  blocked || !selected.length || !message.trim() || repository.staged.length > 0
                }
                onClick={() => void review('commit')}
              >
                <GitCommitHorizontal size={16} />
                Review commit
              </button>
            </div>
          </div>
          <h2>Branch and publishing</h2>
          <div className={styles.form}>
            <label>
              Branch
              <select
                value={branch}
                onChange={(e) => changeForm(() => setBranch(e.target.value))}
                disabled={blocked}
              >
                {branches.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                    {item.current ? ' · current' : ''}
                    {item.worktree && !item.current ? ' · in another checkout' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button
                disabled={blocked || !branch || branch === repository.branch}
                onClick={() => void review('branch')}
              >
                <GitBranch size={16} />
                Review branch change
              </button>
            </div>
            <label>
              Remote
              <select
                value={remote}
                onChange={(e) => changeForm(() => setRemote(e.target.value))}
                disabled={blocked}
              >
                {repository.remotes.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} · {item.url}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button disabled={blocked || !branch || !remote} onClick={() => void review('push')}>
                <Upload size={16} />
                Review push
              </button>
            </div>
          </div>
          {store.mode !== 'edit' && (
            <p className={styles.muted}>
              Queries remain available. Enable Editor mode to prepare Git operations.
            </p>
          )}
        </>
      )}
      {plan && (
        <Dialog title={plan.summary} wide onClose={() => setPlan(null)}>
          <p className={styles.muted}>
            Review {plan.head?.slice(0, 12) ?? 'initial'} · valid until{' '}
            {new Date(plan.expiresAt).toLocaleTimeString('en-GB')}
          </p>
          {plan.remoteUrl && (
            <p>
              <strong>Destination:</strong> {plan.remoteUrl} · {plan.branch}
            </p>
          )}
          {plan.kind === 'push' && (
            <>
              <h3>All outgoing commits ({plan.commits?.length ?? 0})</h3>
              <p className={styles.muted}>Includes commits created outside this interface.</p>
              {plan.commits?.map((commit) => (
                <details key={commit.sha}>
                  <summary>
                    {commit.sha.slice(0, 12)} · {commit.subject}
                  </summary>
                  {commit.files.map((file, i) => (
                    <section key={`${file.path}-${i}`}>
                      <code>
                        {file.status} {file.path}
                      </code>
                      <pre className={styles.rawText}>{file.diff}</pre>
                    </section>
                  ))}
                </details>
              ))}
            </>
          )}
          {plan.files.map((file, i) => (
            <details key={`${file.path}-${i}`} open>
              <summary>
                {file.status} · {file.path}
              </summary>
              <pre className={styles.rawText}>{file.diff || 'No text diff available.'}</pre>
            </details>
          ))}
          <div className={styles.dialogFooter}>
            <button onClick={() => setPlan(null)}>Cancel</button>
            <button className="primary" disabled={blocked} onClick={() => void execute()}>
              Confirm{' '}
              {plan.kind === 'commit'
                ? 'local commit'
                : plan.kind === 'push'
                  ? 'push to remote'
                  : 'branch change'}
            </button>
          </div>
        </Dialog>
      )}
      {guide && <ConnectorSetupGuide provider="git" onClose={() => setGuide(false)} />}
    </main>
  );
}
