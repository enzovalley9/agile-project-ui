import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  FileText,
  GitBranch,
  MessageSquare,
  RefreshCw,
  PanelLeft,
  AlertTriangle,
  FileQuestion,
  CircleCheck,
  BookOpen,
  ListChecks,
  Search,
  Users,
  Layers,
  SunMoon,
  Pencil,
  Eye,
} from 'lucide-react';
import { visibleWorkItems, type WorkItem } from '../../../packages/domain/src/index';
import {
  ProjectStore,
  type ProjectSnapshot,
  type RecoveryStatus,
  type SharedInstallationPreview,
} from './services/project-store';
import { importReadOnlyFiles, readOnlyDirectory } from './services/read-only-project';
import exampleProject from '../../../examples/community-garden.json';
import { FileTree } from './components/FileTree';
import { DocumentReader } from './components/DocumentReader';
import type { SourceSelection } from './components/SourceEditor';
const SourceEditor = lazy(() =>
  import('./components/SourceEditor').then((module) => ({ default: module.SourceEditor })),
);
import { CommentsPanel } from './components/CommentsPanel';
import { StoryBoard, StoryDialog, statusLabel } from './components/WorkViews';
import { Dialog } from './components/Dialog';
import { RecoveryDialog } from './components/RecoveryDialog';
import { GitPanel } from './components/GitPanel';
import { AtlassianPanel } from './components/AtlassianPanel';
import styles from './App.module.css';
import { useTheme, type ThemePreference } from './hooks/use-theme';

type View =
  | 'documents'
  | 'stories'
  | 'epics'
  | 'sprint'
  | 'catalog'
  | 'diagnostics'
  | 'git'
  | 'jira'
  | 'confluence';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const navItems: [View, string][] = [
  ['documents', 'Documents'],
  ['stories', 'Stories'],
  ['epics', 'Epics'],
  ['sprint', 'Sprint'],
  ['catalog', 'Agents and skills'],
  ['diagnostics', 'Diagnostics'],
];
export default function App() {
  const [theme, setTheme] = useTheme();
  const importInput = useRef<HTMLInputElement>(null);
  const folderAccess = 'showDirectoryPicker' in window;
  const [modeChanging, setModeChanging] = useState(false);
  const [installationSetup, setInstallationSetup] = useState<{
    store: ProjectStore;
    preview: SharedInstallationPreview;
  } | null>(null);
  const [store, setStore] = useState<ProjectStore | null>(null),
    [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null),
    [path, setPath] = useState(''),
    [view, setView] = useState<View>('documents'),
    [mode, setMode] = useState<'read' | 'edit'>('read'),
    [format, setFormat] = useState<'visual' | 'source'>('visual'),
    [draft, setDraft] = useState(''),
    [base, setBase] = useState(''),
    [revision, setRevision] = useState(''),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [commentsOpen, setCommentsOpen] = useState(false),
    [commentDirty, setCommentDirty] = useState(false),
    [commentReset, setCommentReset] = useState(0),
    [selection, setSelection] = useState<SourceSelection | null>(null),
    [highlightLine, setHighlightLine] = useState<number>(),
    [selectedItem, setSelectedItem] = useState<WorkItem | null>(null),
    [showDiff, setShowDiff] = useState(false),
    [pending, setPending] = useState<{ action: () => void; description: string } | null>(null),
    [search, setSearch] = useState(''),
    [gitStatus, setGitStatus] = useState('Not connected'),
    [gitBusy, setGitBusy] = useState(false),
    [pendingFragment, setPendingFragment] = useState<string | null>(null),
    [jiraStatus, setJiraStatus] = useState('Not connected'),
    [confluenceStatus, setConfluenceStatus] = useState('Not connected'),
    [integrationBusy, setIntegrationBusy] = useState(false);
  const [recoveryReview, setRecoveryReview] = useState<RecoveryStatus | null>(null);
  const [auxiliarySaving, setAuxiliarySaving] = useState(false),
    [visualDirty, setVisualDirty] = useState(false);
  const visualDirtyRef = useRef(false);
  const onVisualDraft = useCallback((value: boolean) => {
    visualDirtyRef.current = value;
    setVisualDirty(value);
  }, []);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const storeRef = useRef(store);
  storeRef.current = store;
  const pathRef = useRef(path);
  pathRef.current = path;
  const projectGeneration = useRef(0),
    refreshSequence = useRef(0);
  const dirty = draft !== base || visualDirty;
  const stale = !!snapshot && !!path && revision !== snapshot.revisions[path];
  const selectedDoc = snapshot?.index.documents.find((d) => d.path === path);
  const conflicted = !!snapshot?.index.diagnostics.some(
    (d) => d.path === path && d.code === 'merge-conflict',
  );
  const unavailable = snapshot?.diagnostics.find(
    (d) =>
      d.path === path &&
      ['read-error', 'size-limit', 'binary-file', 'depth-limit'].includes(d.code),
  );
  const projected = snapshot ? visibleWorkItems(snapshot.index) : [];
  const diagnostics = [...(snapshot?.diagnostics ?? []), ...(snapshot?.index.diagnostics ?? [])];
  const installationAbsent = snapshot?.index.diagnostics.some(
    (diagnostic) => diagnostic.code === 'installation-absent',
  );
  const changeDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    setNotice('');
  };
  function activate(nextPath: string, nextSnapshot = snapshot) {
    onVisualDraft(false);
    setPath(nextPath);
    setDraft(nextSnapshot?.files[nextPath] ?? '');
    draftRef.current = nextSnapshot?.files[nextPath] ?? '';
    setBase(nextSnapshot?.files[nextPath] ?? '');
    setRevision(nextSnapshot?.revisions[nextPath] ?? '');
    setFormat('visual');
    setSelection(null);
    setHighlightLine(undefined);
    setError('');
    setNotice('');
  }
  function guard(action: () => void, description = 'leave this view') {
    if (saving || auxiliarySaving || gitBusy || integrationBusy) {
      setError('Wait for saving to finish before changing context.');
      return;
    }
    if (dirty || commentDirty) {
      setPending({ action, description });
      return;
    }
    action();
  }
  function exportDraft() {
    (document.activeElement as HTMLElement)?.blur();
    const url = URL.createObjectURL(
      new Blob([draftRef.current], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = path.split('/').at(-1) || 'draft.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function acceptProject(nextStore: ProjectStore, next: ProjectSnapshot, skipped = 0) {
    storeRef.current = nextStore;
    setStore(nextStore);
    setSnapshot(next);
    setInstallationSetup(null);
    setMode('read');
    setView('documents');
    activate(
      next.index.documents.find((d) => d.kind === 'prd')?.path ??
        next.index.documents[0]?.path ??
        '',
      next,
    );
    setCommentsOpen(false);
    setCommentDirty(false);
    setNotice(
      nextStore.readOnly
        ? `Read-only snapshot. ${skipped ? `${skipped} unsupported or excluded files skipped. ` : ''}Changes to the original folder are not refreshed; import it again to reread.`
        : '',
    );
  }
  async function chooseProject(source: 'folder' | 'demo' | readonly File[] = 'folder') {
    const generation = ++projectGeneration.current;
    refreshSequence.current++;
    setError('');
    setBusy(true);
    try {
      let skipped = 0;
      const nextStore =
        source === 'folder'
          ? await ProjectStore.pick()
          : source === 'demo'
            ? new ProjectStore(readOnlyDirectory(exampleProject, 'Community Garden demo'), true)
            : await importReadOnlyFiles(source).then((result) => {
                skipped = result.skipped;
                return new ProjectStore(result.handle, true);
              });
      const next = await nextStore.refresh();
      if (generation !== projectGeneration.current) return;
      acceptProject(nextStore, next, skipped);
    } catch (e) {
      if (generation !== projectGeneration.current) return;
      if (e instanceof DOMException && e.name === 'AbortError')
        setNotice('Folder selection was cancelled.');
      else setError(errorText(e));
    } finally {
      if (generation === projectGeneration.current) setBusy(false);
    }
  }
  async function chooseInstallation(existing?: ProjectStore) {
    setError('');
    setBusy(true);
    try {
      const installation = existing ?? (await ProjectStore.pickInstallation());
      const preview = await installation.previewInstallation();
      setInstallationSetup({ store: installation, preview });
      setNotice('');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function chooseChildProject() {
    if (!installationSetup) return;
    const generation = ++projectGeneration.current;
    refreshSequence.current++;
    setError('');
    setBusy(true);
    try {
      const nextStore = await ProjectStore.pickChildProject(installationSetup.store);
      const next = await nextStore.refresh();
      if (generation !== projectGeneration.current) return;
      acceptProject(nextStore, next);
      setNotice(`Using the shared BMAD installation in ${installationSetup.preview.name}.`);
    } catch (error) {
      if (generation !== projectGeneration.current) return;
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setError(errorText(error));
    } finally {
      if (generation === projectGeneration.current) setBusy(false);
    }
  }
  async function connectSharedInstallation() {
    if (!store) return;
    setError('');
    setBusy(true);
    try {
      await store.attachSharedInstallation();
      await refresh();
      setNotice(`Using the shared BMAD installation in ${store.sharedInstallationName}.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    if (!store) return;
    const generation = projectGeneration.current,
      request = ++refreshSequence.current;
    const next = await store.refresh();
    if (
      storeRef.current !== store ||
      generation !== projectGeneration.current ||
      request !== refreshSequence.current
    )
      return;
    setSnapshot(next);
    if (
      path &&
      pathRef.current === path &&
      !visualDirtyRef.current &&
      draftRef.current === base &&
      next.files[path] !== undefined
    ) {
      setDraft(next.files[path]);
      draftRef.current = next.files[path];
      setBase(next.files[path]);
      setRevision(next.revisions[path]);
    }
  }, [store, path, base]);
  async function addDocumentationFolder() {
    if (!store) return;
    setError('');
    setBusy(true);
    try {
      await store.addDocumentationFolder();
      await refresh();
      setNotice('Documentation folder added to the reading scope.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function manualRefresh() {
    setBusy(true);
    setError('');
    try {
      await refresh();
      setNotice('Files refreshed from the folder.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveDocument() {
    if (
      !store ||
      !path ||
      saving ||
      auxiliarySaving ||
      mode !== 'edit' ||
      gitBusy ||
      integrationBusy ||
      store.recoveryPending ||
      conflicted
    )
      return;
    const value = draftRef.current;
    if (value === base) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await store.save(path, value, revision);
      const next = await store.refresh();
      setSnapshot(next);
      setBase(value);
      setRevision(next.revisions[path]);
      setNotice('Saved locally and verified.');
      setSelection(null);
    } catch (e) {
      setError(errorText(e));
      try {
        setSnapshot(await store.refresh());
      } catch {
        /* Preserve the original write error and draft. */
      }
    } finally {
      setSaving(false);
    }
  }
  const saveRef = useRef(saveDocument);
  saveRef.current = saveDocument;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        void saveRef.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || commentDirty || saving || auxiliarySaving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, commentDirty, saving, auxiliarySaving]);
  useEffect(() => {
    const focus = () => {
      if (!saving && !auxiliarySaving) void refresh().catch((e) => setError(errorText(e)));
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh, saving, auxiliarySaving]);
  function navigateDocument(nextPath: string, fragment?: string) {
    guard(() => {
      setView('documents');
      setSelectedItem(null);
      activate(nextPath);
      setPendingFragment(fragment ?? null);
    }, `open ${nextPath}`);
  }
  useEffect(() => {
    if (!pendingFragment || format !== 'visual') return;
    const frame = requestAnimationFrame(() => {
      let fragment = pendingFragment;
      try {
        fragment = decodeURIComponent(fragment);
      } catch {}
      const target = document.getElementById(fragment);
      if (target) target.scrollIntoView({ block: 'start' });
      else setNotice(`Section “${fragment}” was not found in this document.`);
      setPendingFragment(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [path, draft, format, pendingFragment]);
  function navigateView(next: View) {
    guard(() => {
      setView(next);
      setSelectedItem(null);
    }, `open ${next}`);
  }
  function setEditorMode() {
    guard(() => {
      void (async () => {
        if (!store) return;
        setError('');
        setModeChanging(true);
        try {
          const next = mode === 'read' ? 'edit' : 'read';
          await store.setMode(next);
          setMode(next);
        } catch (e) {
          setError(errorText(e));
        } finally {
          setModeChanging(false);
        }
      })();
    }, 'change mode');
  }
  function jumpToLine(line: number) {
    setFormat('visual');
    setHighlightLine(line);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-source-line="${line}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }),
    );
  }
  const updateCommentDirty = useCallback((value: boolean) => setCommentDirty(value), []);
  const brand = (
    <div className={styles.brand}>
      <span className={styles.mark} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      Agile Project UI
    </div>
  );
  return (
    <div className={styles.app}>
      <input
        ref={importInput}
        type="file"
        multiple
        {...({ webkitdirectory: '' } as Record<string, string>)}
        hidden
        aria-label="Import read-only project folder"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) guard(() => void chooseProject(files), 'import another project');
        }}
      />
      <header className={styles.header}>
        {brand}
        <div className={styles.headerActions}>
          <a
            className={styles.helpLink}
            href={
              import.meta.env.PROD
                ? '/help/'
                : 'https://github.com/enzovalley9/agile-project-ui#readme'
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Help
          </a>
          <label className={styles.themePicker}>
            <SunMoon size={16} aria-hidden="true" />
            <span className="srOnly">Theme</span>
            <select
              aria-label="Theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemePreference)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {store &&
            !store.readOnly &&
            (['git', 'jira', 'confluence'] as const).map((service) => (
              <button
                key={service}
                className={styles.connection}
                aria-pressed={view === service}
                onClick={() => navigateView(service)}
              >
                Connect to {service === 'git' ? 'Git' : service === 'jira' ? 'Jira' : 'Confluence'}
                <span>
                  {service === 'git'
                    ? gitStatus
                    : service === 'jira'
                      ? jiraStatus
                      : confluenceStatus}
                </span>
              </button>
            ))}
        </div>
      </header>
      {store && snapshot && !installationSetup && (
        <>
          <div className={styles.projectBar}>
            <div className={styles.projectName}>
              <FolderOpen size={16} />
              {snapshot.name}
              {snapshot.index.declaredVersion && (
                <span className={styles.muted}>BMAD {snapshot.index.declaredVersion}</span>
              )}
              {store.sharedInstallationName && (
                <span className={styles.muted}>
                  Shared installation: {store.sharedInstallationName}
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <button
                role="switch"
                aria-checked={mode === 'edit'}
                aria-label="Edit mode"
                className={styles.modeSwitch}
                disabled={
                  store.readOnly ||
                  modeChanging ||
                  busy ||
                  saving ||
                  auxiliarySaving ||
                  gitBusy ||
                  integrationBusy
                }
                onClick={setEditorMode}
              >
                <span className={styles.switchTrack}>
                  <span />
                </span>
                {mode === 'edit' ? <Pencil size={14} /> : <Eye size={14} />}
                <span>
                  {store.readOnly
                    ? 'Read-only snapshot'
                    : modeChanging
                      ? 'Requesting permission…'
                      : mode === 'edit'
                        ? 'Edit'
                        : 'Read'}
                </span>
              </button>
              <button
                className="iconButton"
                title={
                  store.readOnly ? 'Import the folder again to reread its files' : 'Refresh files'
                }
                aria-label="Refresh files"
                disabled={
                  store.readOnly || busy || saving || auxiliarySaving || gitBusy || integrationBusy
                }
                onClick={() => void manualRefresh()}
              >
                <RefreshCw size={15} />
              </button>
              <button
                disabled={busy || saving || auxiliarySaving || gitBusy || integrationBusy}
                onClick={() =>
                  guard(
                    () => (folderAccess ? void chooseProject() : importInput.current?.click()),
                    'switch project',
                  )
                }
              >
                {folderAccess ? 'Change folder' : 'Import another folder'}
              </button>
            </div>
          </div>
          <nav className={styles.tabs} aria-label="Project views">
            {navItems.map(([id, label]) => (
              <button
                key={id}
                className={view === id ? 'active' : ''}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => navigateView(id)}
              >
                {label}
                {id === 'diagnostics' && diagnostics.length > 0 ? ` (${diagnostics.length})` : ''}
              </button>
            ))}
          </nav>
        </>
      )}
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          <strong>The action could not be completed.</strong>
          <p>{error}</p>
          {dirty && (
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(draftRef.current)
                  .then(() => setNotice('Draft copied.'))
                  .catch((e) => setError(errorText(e)))
              }
            >
              Copy draft
            </button>
          )}
          <button onClick={() => setError('')}>Dismiss notice</button>
        </div>
      )}
      {notice && (
        <p role="status" className={`${styles.banner} ${styles.bannerSuccess}`}>
          {notice}
        </p>
      )}
      {installationAbsent && !installationSetup && (
        <p role="status" className={`${styles.banner} ${styles.bannerInfo}`}>
          No BMAD installation was detected in this project. Available documents and work items
          remain accessible. You can connect a shared installation from Diagnostics.
        </p>
      )}
      {store?.recoveryPending && (
        <div role="alert" className={styles.banner}>
          <strong>A save needs verification.</strong>
          <p>New writes and Git operations are blocked until the files have been reviewed.</p>
          <button
            onClick={() =>
              void store
                .recoveryStatus()
                .then(setRecoveryReview)
                .catch((e) => setError(errorText(e)))
            }
          >
            Review recovery
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className={`${styles.banner} ${styles.bannerInfo}`}>
          Reading project files…
        </p>
      )}
      {installationSetup ? (
        <main className={styles.welcome}>
          <p className={styles.eyebrow}>Shared BMAD installation</p>
          <h1>Choose the documentation project</h1>
          <p>
            Installation <strong>{installationSetup.preview.name}</strong> is available. Choose the
            project folder inside it. Documents, comments and Git will use that project folder; only
            BMAD configuration is read from this installation.
          </p>
          <div className={styles.startActions}>
            <button className="primary" disabled={busy} onClick={() => void chooseChildProject()}>
              <FolderOpen size={18} /> Choose documentation project
            </button>
            <button disabled={busy} onClick={() => setInstallationSetup(null)}>
              Cancel
            </button>
          </div>
          <h2>Configured document locations</h2>
          <div className={styles.list}>
            {installationSetup.preview.index.roots.map((root, i) => (
              <section key={i} className={styles.listItem}>
                <strong>{root.path || 'Installation root'}</strong>
                <p className={styles.muted}>
                  {root.role} · {root.source}
                </p>
              </section>
            ))}
          </div>
          <p className={styles.muted}>
            These paths are hints from the installation. The browser will ask you to choose the
            child folder explicitly; other repositories are not scanned.
          </p>
        </main>
      ) : !store || !snapshot ? (
        <main className={styles.welcome}>
          <p className={styles.eyebrow}>Public beta · Your project, from its files</p>
          <h1>
            Your project context,
            <br />
            in one place.
          </h1>
          <p>
            Open your project folder to explore documents, epics and stories. Start in read mode,
            then enable editing to work on the original files.
          </p>
          <div className={styles.startActions}>
            <button className="primary" disabled={busy} onClick={() => void chooseProject('demo')}>
              <BookOpen size={18} /> Try the demo
            </button>
            <button disabled={busy || !folderAccess} onClick={() => void chooseProject()}>
              <FolderOpen size={18} /> Choose project folder
            </button>
            <button disabled={busy || !folderAccess} onClick={() => void chooseInstallation()}>
              Choose shared BMAD installation
            </button>
            <button disabled={busy} onClick={() => importInput.current?.click()}>
              Import folder for reading
            </button>
          </div>
          <p className={styles.muted}>
            No account needed. Demo and imported snapshots are read-only. To edit and save
            originals, use desktop Chrome or Edge. Jira and Confluence are experimental; remote
            writes are disabled.
          </p>
          <ol className={styles.firstSteps}>
            <li>
              <strong>Explore.</strong> Try the fictional garden project, including documents,
              stories and a sprint.
            </li>
            <li>
              <strong>Make it yours.</strong>{' '}
              <a href="/example/community-garden.zip" download>
                Download the example ZIP
              </a>
              , extract it and choose that folder in Chrome or Edge. Enable edit mode and save a
              change.
            </li>
            <li>
              <strong>Share when ready.</strong> Optionally connect Git to review, commit and push.{' '}
              <a href="/help/first-use/">Follow the walkthrough</a>.
            </li>
          </ol>
          <p className={styles.muted}>
            Compatible with BMAD Method. An independent project, not affiliated with or endorsed by
            BMAD. Your documents stay on your computer. See the{' '}
            <a href="/help/compatibility/">support matrix</a> and{' '}
            <a href="/help/privacy/">privacy guide</a>.
          </p>
          <div className={styles.welcomeFeatures}>
            <section>
              <BookOpen size={22} />
              <h2>Connected documents</h2>
              <p>A complete file tree, Markdown and links between documents.</p>
            </section>
            <section>
              <ListChecks size={22} />
              <h2>Work with context</h2>
              <p>Stories, states and provenance without duplicating your plans.</p>
            </section>
            <section>
              <MessageSquare size={22} />
              <h2>Discussions beside the text</h2>
              <p>Edit and comment; save your changes before sharing them with Git.</p>
            </section>
          </div>
        </main>
      ) : (
        <>
          {view === 'documents' && (
            <div className={styles.shell}>
              <FileTree
                paths={snapshot.index.documents.map((d) => d.path)}
                selected={path}
                onSelect={navigateDocument}
              />
              <main className={styles.main}>
                {!path ? (
                  <div className={styles.empty}>
                    <FolderOpen size={30} />
                    <h1>Choose a document</h1>
                    <p>
                      {snapshot.index.documents.length
                        ? 'Open a file from the tree to get started.'
                        : 'No supported documents were found in this folder. Check diagnostics to review the scope.'}
                    </p>
                    <button onClick={() => navigateView('diagnostics')}>View diagnostics</button>
                  </div>
                ) : snapshot.files[path] === undefined ? (
                  <div className={styles.empty}>
                    <FileQuestion size={30} />
                    <h1>{unavailable ? 'Could not read the file' : 'File not found'}</h1>
                    <code>{path}</code>
                    <p>
                      {unavailable
                        ? unavailable.message
                        : 'The file may have moved or become unavailable. The rest of the project is still accessible.'}
                    </p>
                    <button onClick={() => void manualRefresh()}>Check again</button>
                  </div>
                ) : (
                  <>
                    <div className={styles.fileHeader}>
                      <p className={styles.filePath}>{path}</p>
                      <div className={styles.fileToolbar}>
                        <span className={styles.saveState} role="status">
                          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes'}
                        </span>
                        <div className={styles.actions}>
                          <button
                            disabled={conflicted}
                            aria-pressed={format === 'source' || conflicted}
                            onClick={() => {
                              (document.activeElement as HTMLElement)?.blur();
                              setFormat(format === 'visual' ? 'source' : 'visual');
                            }}
                          >
                            {format === 'visual' ? 'Markdown' : 'Visual view'}
                          </button>
                          {mode === 'edit' && (
                            <>
                              <button disabled={!dirty} onClick={() => setShowDiff(true)}>
                                Review changes
                              </button>
                              <button
                                className="primary"
                                disabled={
                                  !dirty ||
                                  saving ||
                                  auxiliarySaving ||
                                  stale ||
                                  gitBusy ||
                                  integrationBusy ||
                                  store.recoveryPending ||
                                  conflicted
                                }
                                onClick={() => void saveDocument()}
                              >
                                Save
                              </button>
                            </>
                          )}
                          <button
                            aria-pressed={commentsOpen}
                            onClick={() => setCommentsOpen(!commentsOpen)}
                          >
                            <MessageSquare size={14} />
                            Comments
                          </button>
                        </div>
                      </div>
                    </div>
                    {dirty && (
                      <div className={`${styles.banner} ${styles.bannerInfo}`}>
                        <p>
                          This draft only lives in this tab. Save the file or download a copy before
                          closing or reloading.
                        </p>
                        <button onClick={exportDraft}>Export draft</button>
                      </div>
                    )}
                    {conflicted && (
                      <div className={styles.banner} role="alert">
                        This file contains conflict markers. Resolve them with Git or your editor,
                        then refresh the files. The source remains read-only and is not interpreted.
                      </div>
                    )}
                    {selectedDoc?.derived && mode === 'edit' && (
                      <div className={styles.banner}>
                        This document is derived. BMAD may regenerate it and overwrite manual
                        changes.
                      </div>
                    )}
                    {stale && (
                      <div className={styles.banner} role="alert">
                        <strong>The file changed outside this view.</strong>
                        <p>
                          Your draft is preserved. Compare both versions before continuing; the
                          current file will not be overwritten.
                        </p>
                        <button onClick={() => setShowDiff(true)}>Compare versions</button>
                        <button
                          onClick={() => guard(() => activate(path), 'reload the current file')}
                        >
                          Reload current file
                        </button>
                        <button
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(draftRef.current)
                              .then(() => setNotice('Draft copied.'))
                              .catch((e) => setError(errorText(e)))
                          }
                        >
                          Copy draft
                        </button>
                      </div>
                    )}
                    <div
                      className={`${styles.readerShell} ${commentsOpen ? styles.withComments : ''}`}
                    >
                      <section className={styles.reading}>
                        {selection && mode === 'edit' && !commentsOpen && (
                          <div className={styles.selection}>
                            <p>{selection.quote}</p>
                            <button onClick={() => setCommentsOpen(true)}>
                              Comment on selection
                            </button>
                          </div>
                        )}
                        {format === 'source' || conflicted ? (
                          <Suspense fallback={<p role="status">Opening Markdown editor…</p>}>
                            <SourceEditor
                              value={draft}
                              readOnly={mode === 'read' || conflicted}
                              onChange={changeDraft}
                              onSelect={setSelection}
                              onSave={() => void saveDocument()}
                            />
                          </Suspense>
                        ) : (
                          <DocumentReader
                            store={store}
                            resourceVersion={snapshot}
                            source={draft}
                            path={path}
                            editable={mode === 'edit' && !conflicted}
                            onChange={changeDraft}
                            onNavigate={navigateDocument}
                            onSelect={setSelection}
                            highlightLine={highlightLine}
                            onDraftChange={onVisualDraft}
                          />
                        )}
                      </section>
                      <CommentsPanel
                        store={store}
                        snapshot={snapshot}
                        path={path}
                        source={draft}
                        selection={selection}
                        documentDirty={dirty}
                        hidden={!commentsOpen}
                        onClose={() => setCommentsOpen(false)}
                        onRefresh={refresh}
                        onDirty={updateCommentDirty}
                        onJump={jumpToLine}
                        onBusy={setAuxiliarySaving}
                        resetVersion={commentReset}
                      />
                    </div>
                  </>
                )}
              </main>
            </div>
          )}
          {view === 'stories' && (
            <main>
              <StoryBoard
                snapshot={snapshot}
                store={store}
                onOpen={(item) => setSelectedItem(item)}
                onRefresh={refresh}
                onBusy={setAuxiliarySaving}
                blocked={busy || saving || gitBusy || integrationBusy}
              />
            </main>
          )}
          {view === 'epics' && (
            <main className={styles.content}>
              <div className={styles.contentTitle}>
                <div>
                  <h1>Epics</h1>
                  <p className={styles.muted}>
                    Relationships and content read from the project documents.
                  </p>
                </div>
              </div>
              <div className={styles.list}>
                {projected
                  .filter((i) => i.kind === 'epic')
                  .map((item) => (
                    <section key={item.id} className={styles.listItem}>
                      <h2>
                        {item.nativeId ?? item.id} · {item.title}
                      </h2>
                      {item.status && (
                        <span
                          className={styles.badge}
                          data-status={item.status.valid ? item.status.raw : 'unknown'}
                        >
                          {statusLabel(item.status.raw)}
                        </span>
                      )}
                      <p>{item.description}</p>
                      <p className={styles.muted}>
                        {
                          projected.filter(
                            (i) =>
                              i.kind === 'story' &&
                              (i.epicId === item.id || i.epicId === item.nativeId),
                          ).length
                        }{' '}
                        related stories
                      </p>
                      <button onClick={() => setSelectedItem(item)}>Open epic</button>
                    </section>
                  ))}
              </div>
              {!snapshot.index.workItems.some((i) => i.kind === 'epic') && (
                <p>No recognized epics. You can still read the original files.</p>
              )}
            </main>
          )}
          {view === 'sprint' && (
            <main>
              <StoryBoard
                key="sprint"
                scope="sprint"
                snapshot={snapshot}
                store={store}
                onOpen={(item) => setSelectedItem(item)}
                onRefresh={refresh}
                onBusy={setAuxiliarySaving}
                blocked={busy || saving || gitBusy || integrationBusy}
              />
            </main>
          )}
          {view === 'catalog' && (
            <main className={styles.content}>
              <div className={styles.contentTitle}>
                <div>
                  <h1>Agents and skills</h1>
                  <p className={styles.muted}>
                    Installed catalog. Viewing a definition does not execute it.
                  </p>
                </div>
                <input
                  aria-label="Search catalog"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or module…"
                />
              </div>
              <h2>Agents</h2>
              <div className={styles.catalogGrid}>
                {snapshot.index.agents
                  .filter((a) =>
                    `${a.name} ${a.code} ${a.module}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((a) => (
                    <article className={styles.listItem} key={a.id}>
                      <h3>{a.name}</h3>
                      <p className={styles.muted}>
                        {a.code} · {a.module ?? 'No declared module'}
                        {a.customized ? ' · Customized' : ''}
                      </p>
                      <p>{a.title ?? a.description}</p>
                      <button onClick={() => navigateDocument(a.source)}>View definition</button>
                    </article>
                  ))}
              </div>
              {!snapshot.index.agents.length && (
                <p className={styles.muted}>No recognized agent manifest.</p>
              )}
              <h2>Skills and workflows</h2>
              <div className={styles.catalogGrid}>
                {snapshot.index.skills
                  .filter((a) =>
                    `${a.name} ${a.code} ${a.module}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((a) => (
                    <article className={styles.listItem} key={a.id}>
                      <h3>{a.name}</h3>
                      <p className={styles.muted}>
                        {a.module} {a.phase && `· ${a.phase}`}
                      </p>
                      <p>{a.description}</p>
                      <button onClick={() => navigateDocument(a.source)}>View source</button>
                    </article>
                  ))}
              </div>
              {!snapshot.index.skills.length && (
                <p className={styles.muted}>No recognized skills in the reading scope.</p>
              )}
            </main>
          )}
          {view === 'diagnostics' && (
            <main className={styles.content}>
              <div className={styles.contentTitle}>
                <div>
                  <h1>Project diagnostics</h1>
                  <p className={styles.muted}>
                    Profile{' '}
                    {snapshot.index.compatibility === 'unknown'
                      ? 'unrecognized'
                      : snapshot.index.compatibility}
                    ; coverage {snapshot.index.coverage.partial ? 'partial' : 'configured scope'}.
                  </p>
                </div>
                <button disabled={busy} onClick={() => void manualRefresh()}>
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
              <div className={styles.statGrid}>
                <div className={styles.stat}>
                  <strong>{snapshot.index.documents.length}</strong>
                  <span>Documents</span>
                </div>
                <div className={styles.stat}>
                  <strong>{snapshot.index.workItems.length}</strong>
                  <span>Work items</span>
                </div>
                <div className={styles.stat}>
                  <strong>{snapshot.index.agents.length}</strong>
                  <span>Declared agents</span>
                </div>
                <div className={styles.stat}>
                  <strong>{diagnostics.length}</strong>
                  <span>Notices</span>
                </div>
              </div>
              <div className={styles.contentTitle}>
                <h2>Document roots</h2>
                <button
                  disabled={busy || store.readOnly}
                  onClick={() => void addDocumentationFolder()}
                >
                  <FolderOpen size={15} />
                  Add documentation folder
                </button>
              </div>
              {!store.readOnly && (
                <div className={styles.startActions}>
                  {!installationAbsent && !store.sharedInstallationName ? (
                    <button disabled={busy} onClick={() => void chooseInstallation(store)}>
                      Open child project using this installation
                    </button>
                  ) : (
                    <button disabled={busy} onClick={() => void connectSharedInstallation()}>
                      Connect shared BMAD installation
                    </button>
                  )}
                </div>
              )}
              <div className={styles.list}>
                {snapshot.index.roots.map((root, i) => (
                  <section key={i} className={styles.listItem}>
                    <strong>{root.path || 'Project root'}</strong>
                    <p className={styles.muted}>
                      {root.role} · {root.exists ? 'Available' : 'Not found'}
                    </p>
                    <code>{root.source}</code>
                  </section>
                ))}
              </div>
              <h2>Checks</h2>
              {diagnostics.length ? (
                <div className={styles.list}>
                  {diagnostics.map((d, i) => (
                    <section className={styles.listItem} key={i}>
                      <strong>{d.code}</strong>
                      <p>{d.message}</p>
                      {d.path && (
                        <button className="link" onClick={() => navigateDocument(d.path!)}>
                          {d.path}
                        </button>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <p>
                  <CircleCheck size={16} /> No notices in the files read.
                </p>
              )}
            </main>
          )}
          <GitPanel
            store={store}
            hidden={view !== 'git'}
            context={{
              drafts: Number(dirty) + Number(commentDirty),
              saving: saving || auxiliarySaving,
              recoveryPending: store.recoveryPending || stale,
            }}
            onStatus={setGitStatus}
            onBusy={setGitBusy}
            onRefresh={refresh}
          />
          <AtlassianPanel
            provider="jira"
            store={store}
            snapshot={snapshot}
            activePath={path}
            hidden={view !== 'jira'}
            dirty={dirty || commentDirty}
            saving={saving || auxiliarySaving || gitBusy}
            onStatus={setJiraStatus}
            onBusy={setIntegrationBusy}
            onRefresh={refresh}
          />
          <AtlassianPanel
            provider="confluence"
            store={store}
            snapshot={snapshot}
            activePath={path}
            hidden={view !== 'confluence'}
            dirty={dirty || commentDirty}
            saving={saving || auxiliarySaving || gitBusy}
            onStatus={setConfluenceStatus}
            onBusy={setIntegrationBusy}
            onRefresh={refresh}
          />
          {selectedItem && (
            <StoryDialog
              key={selectedItem.id}
              onOpenItem={setSelectedItem}
              item={snapshot.index.workItems.find((i) => i.id === selectedItem.id) ?? selectedItem}
              snapshot={snapshot}
              store={store}
              onClose={() => setSelectedItem(null)}
              onNavigate={navigateDocument}
              onRefresh={refresh}
              onBusy={setAuxiliarySaving}
            />
          )}
        </>
      )}
      {recoveryReview && store && (
        <RecoveryDialog
          store={store}
          status={recoveryReview}
          onClose={() => setRecoveryReview(null)}
          onBusy={setSaving}
          onRecovered={async () => {
            setRecoveryReview(null);
            await refresh();
            setNotice('File state verified. You can continue your pending changes.');
          }}
        />
      )}
      {showDiff && (
        <Dialog
          title={stale ? 'External change and draft' : 'Document changes'}
          onClose={() => setShowDiff(false)}
          wide
        >
          <p className={styles.filePath}>{path}</p>
          <div className={styles.diff}>
            <section>
              <h3>{stale ? 'Current file on disk' : 'Saved version'}</h3>
              <pre>{stale ? (snapshot?.files[path] ?? 'File unavailable') : base}</pre>
            </section>
            <section>
              <h3>Your draft</h3>
              <pre>{draft}</pre>
            </section>
          </div>
          <div className={styles.dialogFooter}>
            <button onClick={() => setShowDiff(false)}>Back to document</button>
            {!stale && !conflicted && mode === 'edit' && (
              <button
                className="primary"
                disabled={saving || !dirty}
                onClick={() => {
                  setShowDiff(false);
                  void saveDocument();
                }}
              >
                Save
              </button>
            )}
          </div>
        </Dialog>
      )}
      {pending && (
        <Dialog title="Unsaved changes" onClose={() => setPending(null)}>
          <p>
            Before you {pending.description}, decide what to do with drafts in{' '}
            <strong>{path || 'this project'}</strong>.
          </p>
          <p className={styles.muted}>Changes already saved to files will be preserved.</p>
          <div className={styles.dialogFooter}>
            <button autoFocus onClick={() => setPending(null)}>
              Stay here
            </button>
            <button
              onClick={() => {
                const action = pending.action;
                setPending(null);
                setCommentDirty(false);
                setCommentReset((v) => v + 1);
                onVisualDraft(false);
                setDraft(base);
                draftRef.current = base;
                action();
              }}
            >
              Discard drafts and continue
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
