import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Plug, Search, RefreshCw, ArrowLeftRight, Download, Unplug } from 'lucide-react';
import { captureBase, fieldEqual, localFields } from '../../../../packages/integrations/src/index';
import { visibleWorkItems, type FileChange } from '../../../../packages/domain/src/index';
import {
  AtlassianClient,
  type Provider,
  type IntegrationPlan,
  type IntegrationBinding,
  type RemoteResource,
  type ResourceSummary,
  type Scope,
  type AdapterCapabilities,
  type ManagedField,
  type Direction,
  type IntegrationOperation,
  type LocalResource,
  type HistoryEntry,
} from '../services/atlassian-client';
import {
  loadIntegrationState,
  saveIntegrationBinding,
  unlinkIntegrationBinding,
  importIntegrationPlan,
  exportIntegrationPlan,
  saveIntegrationConnection,
  previewIntegrationImport,
  getComparisonBase,
  saveComparisonBase,
  comparisonBasePersistence,
} from '../services/integration-state';
import type { ProjectStore, ProjectSnapshot } from '../services/project-store';
import { Dialog } from './Dialog';
import { ConnectorSetupGuide } from './ConnectorSetupGuide';
import styles from '../App.module.css';

const providerName = { jira: 'Jira', confluence: 'Confluence' };
const fieldName: Record<ManagedField, string> = {
  title: 'Title',
  description: 'Description',
  body: 'Document',
  status: 'Status',
};
const comparisonName: Record<string, string> = {
  equal: 'Match',
  'no-base': 'No common baseline',
  'local-changes': 'Local changes',
  'remote-changes': 'Remote changes',
  'both-changed': 'Both changed',
  convergent: 'Convergent changes',
  partial: 'Partial comparison',
};
const explain = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function indeterminateAtlassianApply(error: unknown) {
  const code = (error as { code?: string })?.code;
  return ![
    'plan_expired',
    'plan_not_found',
    'blocked_plan',
    'remote_stale',
    'scope_mismatch',
    'session_expired',
    'resource_busy',
    'invalid_operation',
    'invalid_content_type',
    'invalid_plan',
    'journal_locked',
    'reconciliation_required',
  ].includes(code ?? '');
}
export function AtlassianPanel({
  provider,
  store,
  snapshot,
  activePath,
  hidden,
  dirty,
  saving,
  onStatus,
  onBusy,
  onRefresh,
}: {
  provider: Provider;
  store: ProjectStore;
  snapshot: ProjectSnapshot;
  activePath: string;
  hidden: boolean;
  dirty: boolean;
  saving: boolean;
  onStatus: (value: string) => void;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const name = providerName[provider],
    defaultEndpoint = provider === 'jira' ? 'http://127.0.0.1:43121' : 'http://127.0.0.1:43122';
  const saved = useMemo(() => {
    try {
      return { ...loadIntegrationState(snapshot, provider), corrupt: '' };
    } catch (error) {
      return {
        path: `.bmad-project-ui/integrations/${provider}.json`,
        revision: null,
        state: {
          schemaVersion: 1 as const,
          projectId: 'unavailable',
          bindings: [] as IntegrationBinding[],
          bases: {},
        },
        corrupt: explain(error),
      };
    }
  }, [snapshot, provider]);
  const [client, setClient] = useState<AtlassianClient | null>(null),
    [draftClient, setDraftClient] = useState<AtlassianClient | null>(null),
    [endpoint, setEndpoint] = useState(defaultEndpoint),
    [token, setToken] = useState(''),
    [wizard, setWizard] = useState<number | null>(null),
    [guide, setGuide] = useState(false),
    [scopes, setScopes] = useState<Scope[]>([]),
    [scopeId, setScopeId] = useState(''),
    [localRoot, setLocalRoot] = useState(''),
    [capabilities, setCapabilities] = useState<AdapterCapabilities | null>(null),
    [checked, setChecked] = useState(false),
    [checkRows, setCheckRows] = useState<{ label: string; value: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<ResourceSummary[]>([]),
    [complete, setComplete] = useState(true),
    [candidate, setCandidate] = useState<RemoteResource | null>(null),
    [bindingId, setBindingId] = useState(''),
    [resource, setResource] = useState<RemoteResource | null>(null),
    [history, setHistory] = useState<HistoryEntry[]>([]),
    [localChoice, setLocalChoice] = useState(''),
    [fields, setFields] = useState<ManagedField[]>(
      provider === 'jira' ? ['title', 'description'] : ['title', 'body'],
    ),
    [direction, setDirection] = useState<Direction>('publish'),
    [plan, setPlan] = useState<IntegrationPlan | null>(null),
    [reviewOpen, setReviewOpen] = useState(false),
    [operation, setOperation] = useState<IntegrationOperation | null>(null),
    [lostPlan, setLostPlan] = useState(''),
    [unlinking, setUnlinking] = useState(false),
    [transitionId, setTransitionId] = useState(''),
    [featureId, setFeatureId] = useState(''),
    [importChanges, setImportChanges] = useState<FileChange[] | null>(null),
    [importError, setImportError] = useState('');
  const [pendingOperations, setPendingOperations] = useState<IntegrationOperation[]>([]),
    [pendingWarning, setPendingWarning] = useState('');
  const generation = useRef(0);
  const reviewedMapping = useRef<{
    revision: string | null;
    bindingId: string;
    binding: string;
    connection: string;
  } | null>(null);
  const priorWizard = useRef({
    scopeId: '',
    localRoot: '',
    capabilities: null as AdapterCapabilities | null,
    scopes: [] as Scope[],
    endpoint: defaultEndpoint,
  });
  const currentBinding =
    saved.state.bindings.find((binding) => binding.id === bindingId) ?? saved.state.bindings[0];
  const projected = visibleWorkItems(snapshot.index);
  const localOptions =
    provider === 'jira'
      ? projected
          .filter((item) => item.kind === 'story' || item.kind === 'epic' || item.kind === 'action')
          .map((item) => ({
            id: item.id,
            path: item.documentPath ?? item.source.path,
            title: `${item.nativeId ?? item.id} · ${item.title}`,
            item,
          }))
      : snapshot.index.documents
          .filter((doc) => /\.md$/i.test(doc.path))
          .map((doc) => ({ id: doc.path, path: doc.path, title: doc.path, item: undefined }));
  const roots = [
    '',
    ...new Set(snapshot.index.roots.filter((root) => root.exists).map((root) => root.path)),
    ...new Set(
      snapshot.index.documents
        .map((doc) => doc.path.split('/').slice(0, -1).join('/'))
        .filter(Boolean),
    ),
  ].filter((path, index, list) => list.indexOf(path) === index);
  const eligible = localOptions.filter(
    (option) => !localRoot || option.path === localRoot || option.path.startsWith(localRoot + '/'),
  );
  const option =
    eligible.find((option) => option.id === localChoice) ??
    eligible.find((option) => option.path === activePath) ??
    eligible[0];
  const jiraBindings = useMemo(() => {
    try {
      return provider === 'confluence' ? loadIntegrationState(snapshot, 'jira').state.bindings : [];
    } catch {
      return [];
    }
  }, [snapshot, provider]);
  const recovery =
    pendingOperations.length > 0 ||
    !!pendingWarning ||
    !!lostPlan ||
    operation?.status === 'uncertain' ||
    operation?.status === 'running' ||
    operation?.status === 'partial' ||
    operation?.status === 'prepared';
  const canConfigure =
    store.mode === 'edit' && !dirty && !saving && !busy && !store.recoveryPending && !saved.corrupt;
  const canWrite = canConfigure && !recovery;
  useEffect(() => {
    onStatus(client?.connected ? 'Connected' : 'Not connected');
  }, [client, onStatus]);
  useEffect(() => {
    generation.current++;
    setClient(null);
    setDraftClient(null);
    setWizard(null);
    setToken('');
    setChecked(false);
    setPlan(null);
    setResource(null);
    setCandidate(null);
    setOperation(null);
    setPendingOperations([]);
    setPendingWarning('');
    setLostPlan('');
    setBindingId('');
  }, [store]);
  useEffect(() => {
    if (hidden && wizard !== null) void cancelWizard();
  }, [hidden]);
  useEffect(() => {
    if (plan && snapshot.revisions[plan.local.path] !== plan.local.revision) {
      setPlan(null);
      setReviewOpen(false);
      setImportChanges(null);
      setNotice('The local file changed. Compare again before applying.');
    }
  }, [snapshot]);
  useEffect(() => {
    if (
      resource &&
      (!currentBinding ||
        resource.id !== currentBinding.resourceId ||
        resource.instance !== currentBinding.instance)
    ) {
      setResource(null);
      setPlan(null);
      setHistory([]);
      setReviewOpen(false);
    }
  }, [currentBinding?.id]);
  useEffect(() => {
    if (
      plan &&
      reviewedMapping.current &&
      (saved.revision !== reviewedMapping.current.revision ||
        JSON.stringify(currentBinding) !== reviewedMapping.current.binding ||
        JSON.stringify('connection' in saved.state ? saved.state.connection : null) !==
          reviewedMapping.current.connection)
    ) {
      setPlan(null);
      setReviewOpen(false);
      setImportChanges(null);
      setNotice('The binding or its scope changed. Compare again before applying.');
    }
  }, [plan, saved.revision, currentBinding]);
  async function run(action: () => Promise<void>, mutation = false) {
    setBusy(true);
    setError('');
    setNotice('');
    if (mutation) onBusy(true);
    try {
      await action();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'session_expired' || code === 'provider_auth_expired') {
        void client?.disconnect().catch(() => undefined);
        setClient(null);
        setPlan(null);
        setResource(null);
        setReviewOpen(false);
      }
      setError(explain(error));
    } finally {
      setBusy(false);
      if (mutation) onBusy(false);
    }
  }
  function invalidate() {
    setPlan(null);
    setReviewOpen(false);
    setCandidate(null);
    setResource(null);
    setHistory([]);
    setChecked(false);
  }
  function startWizard() {
    priorWizard.current = { scopeId, localRoot, capabilities, scopes, endpoint };
    const connection = ('connection' in saved.state ? saved.state.connection : undefined) as
      { scopeId?: string; localRoot?: string } | undefined;
    if (!client && connection) {
      setScopeId(connection.scopeId ?? '');
      setLocalRoot(connection.localRoot === '.' ? '' : (connection.localRoot ?? ''));
    }
    setWizard(0);
    setDraftClient(null);
    setChecked(false);
    setCheckRows([]);
    setToken('');
    setError('');
    setScopes([]);
    generation.current++;
  }
  async function cancelWizard() {
    generation.current++;
    const temporary = draftClient;
    setDraftClient(null);
    setWizard(null);
    setChecked(false);
    setToken('');
    setError('');
    setScopeId(priorWizard.current.scopeId);
    setLocalRoot(priorWizard.current.localRoot);
    setCapabilities(priorWizard.current.capabilities);
    setScopes(priorWizard.current.scopes);
    setEndpoint(priorWizard.current.endpoint);
    if (temporary && temporary !== client) await temporary.disconnect().catch(() => undefined);
  }
  async function authorize() {
    await run(async () => {
      const version = ++generation.current;
      const active = new AtlassianClient(provider, endpoint);
      await active.health();
      const authorized = await active.authorize(token);
      if (version !== generation.current) {
        await active.disconnect();
        return;
      }
      const page = await active.scopes();
      if (version !== generation.current) {
        await active.disconnect();
        return;
      }
      setDraftClient(active);
      setCapabilities(authorized.capabilities);
      setScopes(page.items);
      setComplete(page.complete);
      setScopeId(
        page.items.some((scope) => scope.id === scopeId) ? scopeId : (page.items[0]?.id ?? ''),
      );
      setToken('');
      setWizard(3);
    });
  }
  async function check() {
    if (!draftClient || !scopeId) return;
    await run(async () => {
      const version = ++generation.current;
      setChecked(false);
      setCheckRows([
        { label: 'Identity and service', value: 'Checking…' },
        { label: 'Scope and permissions', value: 'Pending' },
        { label: 'Read a resource', value: 'Pending' },
        { label: 'List coverage', value: 'Pending' },
      ]);
      const caps = await draftClient.capabilities(),
        page = await draftClient.search(scopeId, '');
      if (version !== generation.current) return;
      setCapabilities(caps);
      setComplete(page.complete);
      if (!caps.read)
        throw new Error('The account is recognized but has no read access to this service.');
      if (!page.complete)
        throw new Error('The list is incomplete. Scope coverage cannot be confirmed.');
      if (!page.items.length)
        throw new Error(
          'No accessible resource is available to check this scope. Review the destination.',
        );
      const observed = await draftClient.resource(page.items[0].id);
      if (version !== generation.current) return;
      if (observed.scopeId !== scopeId)
        throw new Error('The checked resource does not belong to the selected scope.');
      setCheckRows([
        {
          label: 'Identity and service',
          value: `${draftClient.identity?.displayName ?? 'Identity unavailable'} · ${name} · ${draftClient.instance}`,
        },
        {
          label: 'Scope and permissions',
          value: `Read access granted · ${scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId}`,
        },
        { label: 'Read a resource', value: `${observed.key ?? observed.id} · ${observed.title}` },
        { label: 'List coverage', value: 'Complete for the queried scope' },
      ]);
      setChecked(true);
    });
  }
  async function discoverPending(active: AtlassianClient) {
    const page = await active.pendingOperations();
    const pending = page.items.filter((item) =>
      ['prepared', 'running', 'uncertain', 'partial'].includes(item.status),
    );
    setPendingOperations(pending);
    setPendingWarning(
      page.complete
        ? page.warnings.join(' ')
        : 'Operation history is incomplete. Check the connector journal before applying more changes. ' +
            page.warnings.join(' '),
    );
    if (pending.length)
      setOperation((current) => pending.find((item) => item.id === current?.id) ?? pending[0]);
  }
  async function saveConnection() {
    if (!draftClient || !capabilities || !checked) return;
    await run(async () => {
      if (recovery && operation && draftClient.instance !== operation.instance)
        throw new Error(
          'An operation is pending on another instance. Reconnect that instance to check it.',
        );
      await discoverPending(draftClient);
      await saveIntegrationConnection(store, snapshot, provider, {
        instance: draftClient.instance,
        deployment: capabilities.deployment,
        scopeId,
        scopeName: scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId,
        localRoot: localRoot || '.',
        checkedAt: new Date().toISOString(),
      });
      setClient(draftClient);
      setDraftClient(null);
      setWizard(null);
      invalidate();
      setChecked(true);
      await onRefresh();
      setNotice(`Connection to ${name} saved. Next, link an existing resource.`);
    }, true);
  }
  async function search() {
    if (!client) return;
    await run(async () => {
      setCandidate(null);
      const page = await client.search(scopeId, query);
      setResults(page.items);
      setComplete(page.complete);
      if (page.warnings.length) setNotice(page.warnings.join(' '));
    });
  }
  async function inspect(id: string) {
    if (!client) return;
    await run(async () => {
      const item = await client.resource(id);
      if (item.instance !== client.instance || item.scopeId !== scopeId)
        throw new Error('The candidate does not belong to the authorized instance and scope.');
      setCandidate(item);
    });
  }
  async function link() {
    if (!candidate || !option || !capabilities) return;
    await run(async () => {
      if (
        saved.state.bindings.some(
          (binding) =>
            binding.instance === candidate.instance &&
            binding.resourceId === candidate.id &&
            (binding.local.path !== option.path || binding.local.entityId !== option.item?.id),
        )
      )
        throw new Error(
          'This remote resource is already linked to another local item. Review that link before continuing.',
        );
      const feature = jiraBindings.find((binding) => binding.id === featureId);
      const binding: IntegrationBinding = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        projectId: saved.state.projectId,
        provider,
        deployment: capabilities.deployment,
        instance: candidate.instance,
        resourceId: candidate.id,
        resourceKey: candidate.key,
        resourceUrl: candidate.url,
        scopeId: candidate.scopeId,
        local: {
          path: option.path,
          entityId: option.item?.id,
          kind: option.item?.kind ?? 'document',
        },
        fields,
        policy: 'review-both-directions',
        normalizerVersion: 1,
        ...(feature
          ? {
              feature: {
                instance: feature.instance,
                issueId: feature.resourceId,
                key: feature.resourceKey,
              },
            }
          : {}),
      };
      await saveIntegrationBinding(store, snapshot, binding);
      setBindingId(binding.id);
      setResource(candidate);
      setCandidate(null);
      setPlan(null);
      await onRefresh();
      setNotice('Link saved. No content was published or imported.');
    }, true);
  }
  async function openBinding(binding: IntegrationBinding) {
    if (!client) return;
    setBindingId(binding.id);
    setPlan(null);
    setImportChanges(null);
    setResource(null);
    setCandidate(null);
    setFields(binding.fields);
    setTransitionId('');
    await run(async () => {
      const remote = await client.resource(binding.resourceId);
      if (remote.instance !== binding.instance)
        throw new Error('The connected instance does not match the identity saved in the link.');
      setResource(remote);
      setHistory((await client.history(binding.resourceId)).items);
    });
  }
  function localForBinding(binding: IntegrationBinding, context = snapshot): LocalResource {
    const item = binding.local.entityId
      ? context.index.workItems.find((item) => item.id === binding.local.entityId)
      : undefined;
    const source = context.files[binding.local.path];
    if (source === undefined) throw new Error('The linked file is unavailable on this branch.');
    if (binding.local.entityId && !item)
      throw new Error(
        'The linked local item was not found. Review its identity before continuing.',
      );
    return {
      path: binding.local.path,
      revision: context.revisions[binding.local.path],
      text: provider === 'jira' ? (item?.description ?? '') : source,
      title:
        item?.title ??
        context.index.documents.find((doc) => doc.path === binding.local.path)?.title,
      status: item?.status?.raw,
      entityId: item?.id,
    };
  }
  async function advanceBase(
    reviewed: IntegrationPlan,
    remote: RemoteResource,
    context: ProjectSnapshot,
  ) {
    if (
      !currentBinding ||
      currentBinding.resourceId !== remote.id ||
      currentBinding.instance !== remote.instance
    )
      return;
    const local = localForBinding(currentBinding, context),
      captured = captureBase(local, remote),
      previous = await getComparisonBase(store, context, provider, currentBinding.id);
    const next = { ...captured, local: { ...previous?.local }, remote: { ...previous?.remote } };
    for (const field of reviewed.fields) {
      next.local[field] = captured.local[field];
      next.remote[field] = captured.remote[field];
    }
    await saveComparisonBase(store, context, provider, currentBinding.id, next);
  }
  async function compare() {
    if (!client || !currentBinding) return;
    await run(async () => {
      reviewedMapping.current = {
        revision: saved.revision,
        bindingId: currentBinding.id,
        binding: JSON.stringify(currentBinding),
        connection: JSON.stringify('connection' in saved.state ? saved.state.connection : null),
      };
      const prepared = await client.plan({
        resourceId: currentBinding.resourceId,
        scopeId: currentBinding.scopeId,
        local: localForBinding(currentBinding),
        base: await getComparisonBase(store, snapshot, provider, currentBinding.id),
        direction,
        fields,
        transitionId: transitionId || undefined,
      });
      if (prepared.resource.instance !== currentBinding.instance)
        throw new Error('The plan instance does not match the reviewed binding.');
      setPlan(prepared);
    });
  }
  async function review() {
    if (!plan) return;
    setImportChanges(null);
    setImportError('');
    setReviewOpen(true);
    if (plan.direction === 'import' && !plan.blockedReasons.length) {
      try {
        setImportChanges(await previewIntegrationImport(snapshot, plan));
      } catch (error) {
        setImportError(explain(error));
      }
    }
  }
  async function apply() {
    if (!plan || !client || !canWrite) return;
    const reviewed = plan;
    setReviewOpen(false);
    await run(async () => {
      const fresh = await store.refresh(),
        mapping = loadIntegrationState(fresh, provider),
        context = reviewedMapping.current;
      if (
        !context ||
        mapping.revision !== context.revision ||
        JSON.stringify(
          mapping.state.bindings.find((binding) => binding.id === context.bindingId),
        ) !== context.binding ||
        JSON.stringify(mapping.state.connection ?? null) !== context.connection
      ) {
        setPlan(null);
        await onRefresh();
        throw new Error(
          'The binding or its scope changed after review. Compare again before applying.',
        );
      }
      if (fresh.revisions[reviewed.local.path] !== reviewed.local.revision) {
        setPlan(null);
        await onRefresh();
        throw new Error('The local file changed after review. Compare again before applying.');
      }
      if (reviewed.direction === 'import') {
        if (!importChanges) throw new Error('Review the exact file differences before importing.');
        const latest = await client.resource(reviewed.resource.id);
        if (
          latest.instance !== reviewed.resource.instance ||
          latest.scopeId !== reviewed.resource.scopeId ||
          latest.version !== reviewed.resource.version ||
          reviewed.fields.some((field) => latest.fields[field] !== reviewed.resource.fields[field])
        )
          throw new Error(
            'The remote resource changed after review. Compare again before importing.',
          );
        await importIntegrationPlan(store, reviewed, {
          confirmed: true,
          reviewedChanges: importChanges,
        });
        await advanceBase(reviewed, latest, await store.refresh());
        setPlan(null);
        await onRefresh();
        setNotice('Import saved locally and verified. Git was not modified.');
      } else {
        try {
          const result = await client.apply(reviewed.id);
          setOperation(result);
          setLostPlan('');
          if (result.status === 'verified') {
            setPlan(null);
            setNotice('Remote fields verified.');
            try {
              const observed = await client.resource(reviewed.resource.id),
                values = localFields(reviewed.local);
              if (
                reviewed.fields.every((field) =>
                  fieldEqual(field, values[field] ?? '', observed.fields[field] ?? ''),
                )
              )
                await advanceBase(reviewed, observed, snapshot);
            } catch {
              setNotice(
                'The remote fields were verified, but a new baseline could not be saved. Compare again.',
              );
            }
          }
        } catch (error) {
          if (indeterminateAtlassianApply(error)) setLostPlan(reviewed.id);
          else {
            setLostPlan('');
            setPlan(null);
            if ((error as { code?: string }).code === 'reconciliation_required')
              await discoverPending(client).catch(() => undefined);
          }
          throw error;
        }
      }
    }, true);
  }
  async function reconcile() {
    if (!client) return;
    await run(async () => {
      const recorded = operation ?? (lostPlan ? await client.operationByPlan(lostPlan) : null);
      if (!recorded) throw new Error('There is not enough evidence of the result yet.');
      const result = await client.reconcile(recorded.id);
      setOperation(result);
      setPendingOperations((current) =>
        current
          .map((item) => (item.id === result.id ? result : item))
          .filter((item) => !['verified', 'rejected'].includes(item.status)),
      );
      setLostPlan('');
      if (result.status === 'verified') {
        setNotice('The operation result was verified without resending it.');
        if (plan && plan.id === result.planId) {
          try {
            const remote = await client.resource(plan.resource.id),
              values = localFields(plan.local);
            if (
              plan.fields.every((field) =>
                fieldEqual(field, values[field] ?? '', remote.fields[field] ?? ''),
              )
            )
              await advanceBase(plan, remote, await store.refresh());
          } catch {
            /* Verification remains valid even when a later base cannot be captured. */
          }
        }
      }
    }, true);
  }
  function exportCandidate() {
    if (!plan) return;
    const blob = new Blob([exportIntegrationPlan(plan)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bmad-${provider}-plan-${plan.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const blocking = [
    ...(plan?.blockedReasons ?? []),
    ...(importError ? [importError] : []),
    ...(saved.corrupt ? [saved.corrupt] : []),
    ...(store.recoveryPending ? ['Check the pending local save before continuing.'] : []),
    ...(dirty ? ['Save or discard the local draft before applying.'] : []),
    ...(store.mode !== 'edit' ? ['Enable Editor mode to apply changes.'] : []),
    ...(recovery ? ['Check the pending operation before preparing another.'] : []),
  ];
  return (
    <main hidden={hidden} className={`${styles.content} ${styles.connectionPage}`}>
      <div className={styles.contentTitle}>
        <div>
          <h1>Connection to {name}</h1>
          <p className={styles.muted}>Link, compare, and review changes to each resource.</p>
        </div>
        <span className={styles.badge} data-status={client?.connected ? 'done' : 'backlog'}>
          {client?.connected ? 'Connected for reading' : 'Not connected'}
        </span>
      </div>
      {saved.corrupt && (
        <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          The configuration for this integration cannot be parsed. {saved.corrupt} The original
          files are preserved.
        </div>
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
      {notice && (
        <p
          role="status"
          className={`${styles.banner} ${styles.bannerInfo}`}
          style={{ margin: '16px 0' }}
        >
          {notice}
        </p>
      )}
      {wizard === null ? (
        <>
          {!client ? (
            <>
              <p>
                The connector for {name} is independent of Git and the other integration. Your
                documents remain available without connecting an account.
              </p>
              <button className="primary" onClick={startWizard}>
                <Plug size={16} />
                Set up connection
              </button>
              <p>
                Install the local package, configure your account on this computer, then load the
                generated session file to connect.
              </p>
              <button onClick={() => setGuide(true)}>
                <Download size={16} />
                Install {name} connector
              </button>
            </>
          ) : (
            <section className={styles.listItem}>
              <h2>{client.instance}</h2>
              <p className={styles.muted}>
                {capabilities?.deployment === 'cloud' ? 'Cloud' : 'Data Center'} ·{' '}
                {capabilities?.profile} ·{' '}
                {scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId}
              </p>
              <p>
                Local scope: <code>{localRoot || 'Project root'}</code>
              </p>
              <p className={styles.muted}>
                The connection verifies access; it does not mean the content is synchronized.
              </p>
              <div className={styles.actions}>
                <button disabled={busy || recovery} onClick={startWizard}>
                  Review configuration
                </button>
                <button
                  disabled={busy || recovery}
                  onClick={() =>
                    void run(async () => {
                      await client.disconnect();
                      setClient(null);
                      setPlan(null);
                      setResource(null);
                      setNotice('Connection closed. Links and files are preserved.');
                    })
                  }
                >
                  <Unplug size={14} />
                  Disconnect
                </button>
              </div>
            </section>
          )}
          {client && (
            <>
              <h2>Links {name}</h2>
              {saved.state.bindings.length > 0 ? (
                <div className={styles.list}>
                  {saved.state.bindings.map((binding) => (
                    <button
                      className={styles.listItem}
                      style={{ textAlign: 'left', justifyContent: 'space-between' }}
                      key={binding.id}
                      aria-pressed={binding.id === currentBinding?.id}
                      disabled={busy || recovery}
                      onClick={() => void openBinding(binding)}
                    >
                      <span>
                        {binding.local.path}
                        <br />
                        <small>
                          {binding.instance} · {binding.resourceKey ?? binding.resourceId}
                        </small>
                      </span>
                      <ArrowLeftRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>
                  No links yet. Searching for a candidate does not create remote resources.
                </p>
              )}
              <details
                className={styles.listItem}
                open={!saved.state.bindings.length}
                style={{ marginTop: 20 }}
              >
                <summary>
                  Link {provider === 'jira' ? 'a story or epic' : 'a document'} to an existing
                  resource
                </summary>
                <div className={styles.form}>
                  <label>
                    Local item
                    <select
                      value={option?.id ?? ''}
                      onChange={(e) => {
                        setLocalChoice(e.target.value);
                        setCandidate(null);
                      }}
                      disabled={busy}
                    >
                      <option value="" disabled>
                        Select an item
                      </option>
                      {eligible.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Search in {name}
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={provider === 'jira' ? 'Issue key or title' : 'Page title'}
                      disabled={busy}
                    />
                  </label>
                  <div>
                    <button disabled={busy || !scopeId} onClick={() => void search()}>
                      <Search size={15} />
                      Find candidates
                    </button>
                  </div>
                </div>
                {!complete && (
                  <div role="alert" className={styles.banner}>
                    The list is incomplete. A missing resource is not treated as a deletion.
                  </div>
                )}
                <div className={styles.list}>
                  {results.map((item) => (
                    <button key={item.id} onClick={() => void inspect(item.id)} disabled={busy}>
                      {item.key ?? item.id} · {item.title}
                    </button>
                  ))}
                </div>
                {candidate && (
                  <>
                    <div className={styles.diff}>
                      <section className={styles.listItem}>
                        <h3>Local</h3>
                        <strong>{option?.title}</strong>
                        <p className={styles.muted}>{option?.path}</p>
                      </section>
                      <section className={styles.listItem}>
                        <h3>{name}</h3>
                        <strong>{candidate.title}</strong>
                        <p className={styles.muted}>
                          {candidate.instance} · ID {candidate.id} · {candidate.key} · scope{' '}
                          {candidate.scopeId}
                        </p>
                      </section>
                    </div>
                    {provider === 'confluence' && (
                      <label>
                        Relate to a Jira feature (optional)
                        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
                          <option value="">No additional relationship</option>
                          {jiraBindings.map((binding) => (
                            <option key={binding.id} value={binding.id}>
                              {binding.resourceKey ?? binding.resourceId} · {binding.instance}
                            </option>
                          ))}
                        </select>
                        <p className={styles.muted}>
                          The relationship does not copy the document to Jira or change the feature
                          status.
                        </p>
                      </label>
                    )}
                    <button
                      className="primary"
                      disabled={!canWrite || !option || !complete}
                      onClick={() => void link()}
                    >
                      <Link2 size={15} />
                      Confirm link
                    </button>
                  </>
                )}
              </details>
              {resource && currentBinding && (
                <section style={{ marginTop: 28 }}>
                  <div className={styles.contentTitle}>
                    <div>
                      <h2>{resource.title}</h2>
                      <p className={styles.muted}>
                        {resource.instance} · {resource.key ?? resource.id} · version{' '}
                        {resource.version}
                      </p>
                      <p className={styles.muted}>{currentBinding.local.path}</p>
                      {/^https:\/\//i.test(resource.url) && (
                        <a href={resource.url} target="_blank" rel="noopener noreferrer">
                          Open in {name}
                        </a>
                      )}
                    </div>
                    <button disabled={!canWrite} onClick={() => setUnlinking(true)}>
                      Remove link
                    </button>
                  </div>
                  <div className={styles.actions}>
                    {(capabilities?.fields ?? fields).map((field) => (
                      <label className={styles.checkboxRow} key={field}>
                        <input
                          type="checkbox"
                          disabled={busy || recovery}
                          checked={fields.includes(field)}
                          onChange={(event) => {
                            setPlan(null);
                            setFields((current) =>
                              event.target.checked
                                ? [...current, field]
                                : current.filter((value) => value !== field),
                            );
                          }}
                        />
                        {fieldName[field]}
                      </label>
                    ))}
                  </div>
                  <div className={styles.form}>
                    <label>
                      Direction
                      <select
                        disabled={busy || recovery}
                        value={direction}
                        onChange={(e) => {
                          setPlan(null);
                          setDirection(e.target.value as Direction);
                        }}
                      >
                        <option value="publish">Publish local → {name}</option>
                        <option value="import">Import {name} → local</option>
                      </select>
                    </label>
                    {provider === 'jira' && fields.includes('status') && (
                      <label>
                        Explicit Jira transition
                        <select
                          disabled={busy || recovery}
                          value={transitionId}
                          onChange={(e) => {
                            setTransitionId(e.target.value);
                            setPlan(null);
                          }}
                        >
                          <option value="">No confirmed mapping</option>
                          {resource.transitions?.map((transition) => (
                            <option key={transition.id} value={transition.id}>
                              {transition.name} → {transition.toStatusName} · ID {transition.id}
                              {transition.requiredFields.length
                                ? ` · requires ${transition.requiredFields.join(', ')}`
                                : ''}
                            </option>
                          ))}
                        </select>
                        <small>
                          Local status:{' '}
                          {snapshot.index.workItems.find(
                            (item) => item.id === currentBinding.local.entityId,
                          )?.status?.raw ?? 'not declared'}
                          . The change is only applied if the adapter can guarantee it.
                        </small>
                      </label>
                    )}
                    <div>
                      <button
                        disabled={busy || !fields.length || recovery}
                        onClick={() => void compare()}
                      >
                        <ArrowLeftRight size={15} />
                        Compare fields
                      </button>
                    </div>
                  </div>
                  {plan && (
                    <>
                      <div className={styles.contentTitle}>
                        <h2>{comparisonName[plan.comparison.state] ?? plan.comparison.state}</h2>
                        <span className={styles.muted}>
                          Checked {new Date(plan.comparison.observedAt).toLocaleString('en-GB')}
                        </span>
                      </div>
                      {plan.comparison.rows.some(
                        (row) => row.baseLocal !== undefined || row.baseRemote !== undefined,
                      ) && (
                        <p className={styles.muted}>
                          {comparisonBasePersistence(store) === 'persistent'
                            ? 'Private baseline saved in this browser. Only verified fields advance.'
                            : 'Private baseline for this session only; persistent storage is unavailable.'}
                        </p>
                      )}
                      {!plan.comparison.coverage.complete && (
                        <div className={styles.banner}>
                          Partial comparison: {plan.comparison.coverage.unsupported.join(', ')}.
                          Content that cannot be preserved is not replaced.
                        </div>
                      )}
                      {plan.comparison.rows.map((row) => (
                        <section key={row.field} className={styles.comparisonField}>
                          <div className={styles.contentTitle}>
                            <h3>{fieldName[row.field]}</h3>
                            <span
                              className={styles.badge}
                              data-status={row.state === 'equal' ? 'done' : 'unknown'}
                            >
                              {comparisonName[row.state] ?? row.state}
                            </span>
                          </div>
                          <div className={styles.threeWay}>
                            <section>
                              <h4>Common baseline</h4>
                              <pre>{row.baseLocal ?? 'No verified common baseline'}</pre>
                            </section>
                            <section>
                              <h4>Local</h4>
                              <pre>{row.local || 'No content'}</pre>
                            </section>
                            <section>
                              <h4>{name}</h4>
                              <pre>{row.remote || 'No content'}</pre>
                            </section>
                          </div>
                        </section>
                      ))}
                      <details>
                        <summary>View source representation</summary>
                        <div className={styles.diff}>
                          <section>
                            <h3>Local source</h3>
                            <pre>{plan.local.text}</pre>
                          </section>
                          <section>
                            <h3>{resource.representation}</h3>
                            <pre>{JSON.stringify(resource.fields, null, 2)}</pre>
                          </section>
                        </div>
                      </details>
                      <div className={styles.actions}>
                        <button
                          className="primary"
                          disabled={busy || recovery}
                          onClick={() => void review()}
                        >
                          Review {direction === 'publish' ? 'publication' : 'import'}
                        </button>
                        <button onClick={exportCandidate}>
                          <Download size={15} />
                          Export candidate
                        </button>
                      </div>
                    </>
                  )}
                  <details style={{ marginTop: 20 }}>
                    <summary>
                      {provider === 'jira' ? 'Accessible history' : 'Page versions'}
                    </summary>
                    {history.length ? (
                      history.map((entry) => (
                        <p className={styles.muted} key={entry.id}>
                          {entry.version ?? entry.id} · {entry.summary}{' '}
                          {entry.createdAt && new Date(entry.createdAt).toLocaleString('en-GB')}
                        </p>
                      ))
                    ) : (
                      <p className={styles.muted}>No history was retrieved for this resource.</p>
                    )}
                  </details>
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <section>
          <div className={styles.contentTitle}>
            <h2>Configure {name}</h2>
            <button disabled={busy && wizard === 5} onClick={() => void cancelWizard()}>
              Cancel
            </button>
          </div>
          <ol className={styles.wizardSteps}>
            {['Prepare', 'Instance', 'Authorize', 'Scope', 'Check', 'Summary'].map(
              (step, index) => (
                <li key={step} aria-current={wizard === index ? 'step' : undefined}>
                  {index + 1}. {step}
                </li>
              ),
            )}
          </ol>
          {wizard === 0 && (
            <div className={styles.guide}>
              <p>
                Connecting does not publish documents or create issues. First, check the service and
                choose its scope.
              </p>
              <ol>
                <li>Open the connector for {name} with the instance and credentials configured.</li>
                <li>Load its local session file.</li>
                <li>Choose the remote destination and project folder.</li>
                <li>Check access and save the configuration.</li>
              </ol>
              <p className={styles.muted}>
                Provider credentials remain on the connector system. They are not saved in the
                project.
              </p>
              <button onClick={() => setGuide(true)}>
                <Download size={16} />
                Installation and startup instructions
              </button>
            </div>
          )}
          {wizard === 1 && (
            <div className={styles.form}>
              <label>
                Local connector address for {name}
                <input
                  type="url"
                  value={endpoint}
                  onChange={(e) => {
                    setEndpoint(e.target.value);
                    setChecked(false);
                    generation.current++;
                    if (draftClient) void draftClient.disconnect().catch(() => undefined);
                    setDraftClient(null);
                    setCapabilities(null);
                    setScopes([]);
                  }}
                />
              </label>
              <p>
                The Cloud or Data Center deployment and instance are checked against the connector
                profile. Entering an address does not establish compatibility.
              </p>
            </div>
          )}
          {wizard === 2 && (
            <div className={styles.form}>
              <label>
                Local session key
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Load session file for {name}
                <input
                  type="file"
                  aria-label={`Load session file for ${name}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    if (file.size > 4096) {
                      setError('The session file size is invalid.');
                      return;
                    }
                    const version = generation.current;
                    void file
                      .text()
                      .then((value) => {
                        if (version === generation.current) setToken(value.trim());
                      })
                      .catch(() => setError('The session file could not be read.'));
                  }}
                />
              </label>
              <p className={styles.muted}>
                Used only in memory. It is not sent to Jira or Confluence; it authorizes this web
                app with the local connector.
              </p>
              {draftClient?.connected && (
                <button disabled={busy} onClick={() => setWizard(3)}>
                  Continue with authorized connection
                </button>
              )}
              <div>
                <button
                  className="primary"
                  disabled={busy || !token}
                  onClick={() => void authorize()}
                >
                  {busy ? 'Authorizing…' : `Authorize connection to ${name}`}
                </button>
              </div>
            </div>
          )}
          {wizard === 3 && (
            <div className={styles.form}>
              <p>
                Verified instance: <strong>{draftClient?.instance}</strong> ·{' '}
                {capabilities?.deployment}
              </p>
              <p>
                Verified account: <strong>{draftClient?.identity?.displayName}</strong> · ID{' '}
                {draftClient?.identity?.id}
              </p>
              <label>
                {provider === 'jira' ? 'Jira project' : 'Confluence space'}
                <select
                  value={scopeId}
                  onChange={(e) => {
                    setScopeId(e.target.value);
                    setChecked(false);
                  }}
                >
                  {scopes.map((scope) => (
                    <option key={scope.id} value={scope.id}>
                      {scope.name} · {scope.key ?? scope.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Included local folder
                <select
                  value={localRoot}
                  onChange={(e) => {
                    setLocalRoot(e.target.value);
                    setChecked(false);
                  }}
                >
                  {roots.map((root) => (
                    <option key={root} value={root}>
                      {root || 'Project root'}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.muted}>
                The folder limits the candidates. Selecting it does not authorize publishing every
                file. Secrets, conversations, and private connector data are excluded from
                synchronized content.
              </p>
              {!complete && (
                <p role="alert">The destination list is incomplete; check again before saving.</p>
              )}
            </div>
          )}
          {wizard === 4 && (
            <>
              <ul className={styles.verifications}>
                {checkRows.map((row) => (
                  <li key={row.label}>
                    <strong>{row.label}</strong>
                    <span>{row.value}</span>
                  </li>
                ))}
              </ul>
              <button disabled={busy} className="primary" onClick={() => void check()}>
                <RefreshCw size={15} />
                {busy ? 'Checking…' : 'Check access and resource'}
              </button>
            </>
          )}
          {wizard === 5 && (
            <>
              <h3>Review the connection</h3>
              <dl className={styles.summaryList}>
                <dt>Service</dt>
                <dd>
                  {name} · {capabilities?.deployment}
                </dd>
                <dt>Instance</dt>
                <dd>{draftClient?.instance}</dd>
                <dt>Account</dt>
                <dd>
                  {draftClient?.identity?.displayName} · ID {draftClient?.identity?.id}
                </dd>
                <dt>Destination</dt>
                <dd>
                  {scopes.find((scope) => scope.id === scopeId)?.name} · ID {scopeId}
                </dd>
                <dt>Local folder</dt>
                <dd>{localRoot || 'Project root'}</dd>
                <dt>Capabilities</dt>
                <dd>
                  Reading and comparison {capabilities?.read ? 'verified' : 'unavailable'}. Remote
                  writes{' '}
                  {capabilities?.remoteUpdate
                    ? 'supported by this profile'
                    : 'blocked by provider safeguards'}
                  .
                </dd>
              </dl>
              <p className={styles.muted}>
                Saving does not link a document or establish a common comparison baseline.
              </p>
              {store.mode !== 'edit' && (
                <p>Enable Editor mode to save this configuration in the project.</p>
              )}
            </>
          )}
          <div className={styles.dialogFooter}>
            {wizard > 0 && (
              <button
                disabled={busy}
                onClick={() => {
                  setWizard(wizard - 1);
                  setChecked(wizard >= 4 ? false : checked);
                }}
              >
                Back
              </button>
            )}
            {wizard !== 2 && wizard < 5 && (
              <button
                className="primary"
                disabled={
                  busy || (wizard === 3 && (!scopeId || !complete)) || (wizard === 4 && !checked)
                }
                onClick={() => setWizard(wizard + 1)}
              >
                Next
              </button>
            )}
            {wizard === 5 && (
              <button
                className="primary"
                disabled={!canConfigure || !checked}
                onClick={() => void saveConnection()}
              >
                Save connection
              </button>
            )}
          </div>
        </section>
      )}
      {pendingWarning && (
        <p role="alert" className={styles.banner}>
          {pendingWarning}
          {client && (
            <button disabled={busy} onClick={() => void run(() => discoverPending(client))}>
              Check operations again
            </button>
          )}
        </p>
      )}
      {pendingOperations.length > 1 && (
        <section>
          <h2>Pending operations</h2>
          {pendingOperations.map((item) => (
            <button
              key={item.id}
              aria-pressed={operation?.id === item.id}
              disabled={busy}
              onClick={() => setOperation(item)}
            >
              {item.resourceId} · {item.status} · {item.id}
            </button>
          ))}
        </section>
      )}
      {(recovery || operation) && (
        <div className={styles.banner} role="status" style={{ margin: '20px 0' }}>
          <strong>
            {operation?.status === 'verified'
              ? 'Verified result'
              : operation?.status === 'rejected'
                ? 'Not applied'
                : operation?.status === 'partial'
                  ? 'Partial result'
                  : 'Unconfirmed result'}
          </strong>
          <p>
            {operation?.message ??
              'The response did not arrive. Check the result before repeating the operation.'}
          </p>
          {recovery && (
            <button disabled={busy} onClick={() => void reconcile()}>
              Check result
            </button>
          )}
        </div>
      )}
      {reviewOpen && plan && (
        <Dialog
          title={plan.direction === 'publish' ? `Publish to ${name}` : `Import from ${name}`}
          wide
          onClose={() => setReviewOpen(false)}
        >
          <p>
            {plan.resource.instance} · {plan.resource.key ?? plan.resource.id} · version{' '}
            {plan.resource.version}
          </p>
          <p className={styles.filePath}>{plan.local.path}</p>
          <p>Selected fields: {plan.fields.map((field) => fieldName[field]).join(', ')}.</p>
          <div className={styles.diff}>
            <section>
              <h3>Before · {plan.direction === 'publish' ? name : 'Local'}</h3>
              <pre>
                {plan.comparison.rows
                  .filter((row) => plan.fields.includes(row.field))
                  .map(
                    (row) =>
                      `${fieldName[row.field]}\n${plan.direction === 'publish' ? row.remote : row.local}`,
                  )
                  .join('\n\n')}
              </pre>
            </section>
            <section>
              <h3>After · {plan.direction === 'publish' ? name : 'Local'}</h3>
              <pre>
                {plan.comparison.rows
                  .filter((row) => plan.fields.includes(row.field))
                  .map(
                    (row) =>
                      `${fieldName[row.field]}\n${plan.direction === 'publish' ? row.local : row.remote}`,
                  )
                  .join('\n\n')}
              </pre>
            </section>
          </div>
          {plan.direction === 'import' && importChanges && (
            <section>
              <h3>Local files that will change</h3>
              {importChanges.length ? (
                importChanges.map((change) => (
                  <section key={change.path}>
                    <code>{change.path}</code>
                    <div className={styles.diff}>
                      <section>
                        <h4>Current file</h4>
                        <pre>{change.before}</pre>
                      </section>
                      <section>
                        <h4>File after import</h4>
                        <pre>{change.after}</pre>
                      </section>
                    </div>
                  </section>
                ))
              ) : (
                <p>No local changes to apply.</p>
              )}
            </section>
          )}
          {blocking.length > 0 && (
            <div className={styles.banner} role="alert">
              <strong>Apply blocked</strong>
              <ul>
                {blocking.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.transportLoss.length > 0 && (
            <p>Transformations and limits: {plan.transportLoss.join('; ')}</p>
          )}
          <p className={styles.muted}>
            Only selected fields are used. Comments, reactions, secrets, and journals are excluded.
            Local saves, commits, and pushes remain separate.
          </p>
          <div className={styles.dialogFooter}>
            <button onClick={() => setReviewOpen(false)}>Compare again</button>
            <button onClick={exportCandidate}>Export candidate</button>
            <button
              className="primary"
              disabled={
                !canWrite ||
                blocking.length > 0 ||
                (plan.direction === 'import' && !importChanges?.length)
              }
              onClick={() => void apply()}
            >
              Confirm {plan.direction === 'publish' ? 'publication' : 'import'}
            </button>
          </div>
        </Dialog>
      )}
      {unlinking && currentBinding && (
        <Dialog title="Remove link" onClose={() => setUnlinking(false)}>
          <p>
            The link between <strong>{currentBinding.local.path}</strong> and{' '}
            {currentBinding.resourceKey ?? currentBinding.resourceId} will be removed. Files and the
            remote resource will be preserved.
          </p>
          <div className={styles.dialogFooter}>
            <button onClick={() => setUnlinking(false)}>Cancel</button>
            <button
              disabled={!canWrite}
              onClick={() =>
                void run(async () => {
                  await unlinkIntegrationBinding(store, snapshot, provider, currentBinding.id);
                  setUnlinking(false);
                  setBindingId('');
                  setResource(null);
                  setPlan(null);
                  await onRefresh();
                }, true)
              }
            >
              Confirm unlinking
            </button>
          </div>
        </Dialog>
      )}
      {guide && <ConnectorSetupGuide provider={provider} onClose={() => setGuide(false)} />}
    </main>
  );
}
