import {
  adfProjection,
  markdownProjection,
  opaqueProjection,
  toAdf,
  managedBody,
} from '../../../packages/integrations/src/index';
import type {
  AdapterCapabilities,
  Deployment,
  HistoryEntry,
  IntegrationPlan,
  Page,
  PlanRequest,
  Provider,
  RemoteResource,
  ResourceSummary,
  Scope,
} from '../../../packages/integrations/src/index';
import { ConnectorError, identifier, ProviderTransport, query } from './transport';
export interface ProviderAdapter {
  readonly capabilities: AdapterCapabilities;
  readonly instance: string;
  identity(): Promise<{ id: string; displayName: string } | { unavailableReason: string }>;
  scopes(): Promise<Page<Scope>>;
  search(scope: string, q: string): Promise<Page<ResourceSummary>>;
  read(id: string): Promise<RemoteResource>;
  history(id: string): Promise<Page<HistoryEntry>>;
  candidate(request: PlanRequest, resource: RemoteResource): IntegrationPlan['candidate'];
  apply(plan: IntegrationPlan): Promise<void>;
}
export interface AdapterOptions {
  provider: Provider;
  deployment?: Deployment;
  transport: ProviderTransport;
}
export function createAdapter(options: AdapterOptions): ProviderAdapter {
  return options.provider === 'jira' ? new JiraAdapter(options) : new ConfluenceAdapter(options);
}
abstract class BaseAdapter implements ProviderAdapter {
  readonly instance: string;
  abstract readonly capabilities: AdapterCapabilities;
  protected transport: ProviderTransport;
  protected deployment: Deployment;
  constructor(options: AdapterOptions) {
    this.transport = options.transport;
    this.instance = options.transport.instance;
    this.deployment = options.deployment ?? 'cloud';
  }
  abstract identity(): Promise<{ id: string; displayName: string } | { unavailableReason: string }>;
  abstract scopes(): Promise<Page<Scope>>;
  abstract search(scope: string, q: string): Promise<Page<ResourceSummary>>;
  abstract read(id: string): Promise<RemoteResource>;
  abstract history(id: string): Promise<Page<HistoryEntry>>;
  abstract candidate(request: PlanRequest, resource: RemoteResource): IntegrationPlan['candidate'];
  async apply(_plan: IntegrationPlan): Promise<void> {
    throw new ConnectorError(
      'unsafe_remote_update',
      this.capabilities.blockedReasons.join('; '),
      409,
    );
  }
  protected nextCursor(next: unknown, expectedPath: string): string | undefined {
    if (!next) return undefined;
    try {
      const u = new URL(String(next), this.instance);
      const base = new URL(this.instance);
      if (
        u.origin !== base.origin ||
        u.pathname !== base.pathname.replace(/\/$/, '') + expectedPath
      )
        throw new Error();
      const cursor = u.searchParams.get('cursor');
      if (!cursor || cursor.length > 2000) throw new Error();
      return cursor;
    } catch {
      throw new ConnectorError(
        'invalid_pagination',
        'Provider returned an unsafe pagination link',
        502,
      );
    }
  }
}
export class JiraAdapter extends BaseAdapter {
  readonly capabilities: AdapterCapabilities;
  private get api() {
    return `/rest/api/${this.deployment === 'cloud' ? '3' : '2'}`;
  }
  constructor(options: AdapterOptions) {
    super(options);
    this.capabilities = {
      provider: 'jira',
      deployment: this.deployment,
      profile: this.deployment === 'cloud' ? 'jira-cloud-rest-v3' : 'jira-dc-rest-v2-read',
      read: true,
      search: true,
      compare: true,
      import: true,
      export: true,
      remoteUpdate: false,
      fields:
        this.deployment === 'cloud' ? ['title', 'description', 'status'] : ['title', 'status'],
      representations: [this.deployment === 'cloud' ? 'adf' : 'wiki'],
      concurrency: 'none',
      blockedReasons: [
        'Jira issue update has no verified atomic version precondition in this adapter',
      ],
      liveVerified: false,
    };
  }
  async identity() {
    const user = await this.transport.request(this.api + '/myself');
    const id = user.accountId ?? user.key ?? user.name;
    if (!id || typeof user.displayName !== 'string')
      throw new ConnectorError(
        'invalid_identity',
        'Provider did not identify the authenticated account',
        502,
      );
    return { id: String(id), displayName: user.displayName as string };
  }
  async scopes(): Promise<Page<Scope>> {
    const items: Scope[] = [];
    let startAt = 0;
    for (let page = 0; page < 10; page++) {
      const data = await this.transport.request(
        this.api +
          (this.deployment === 'cloud'
            ? '/project/search' + query({ startAt, maxResults: 50 })
            : '/project'),
      );
      const rows = this.deployment === 'cloud' ? data.values : data;
      if (!Array.isArray(rows))
        throw new ConnectorError('invalid_provider_response', 'Missing project collection', 502);
      for (const p of rows) items.push({ id: String(p.id), key: p.key, name: p.name });
      if (
        this.deployment !== 'cloud' ||
        data.isLast === true ||
        startAt + rows.length >= data.total ||
        rows.length === 0
      )
        return { items, complete: true, warnings: [] };
      startAt += rows.length;
    }
    return { items, complete: false, warnings: ['Project pagination limit reached'] };
  }
  async search(scope: string, text: string): Promise<Page<ResourceSummary>> {
    identifier(scope);
    if (text.length > 300) throw new ConnectorError('invalid_query', 'Search is too long');
    const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql = `project = "${escape(scope)}"${text ? ` AND text ~ "${escape(text)}"` : ''} ORDER BY key ASC`;
    const items: ResourceSummary[] = [];
    let nextPageToken: string | undefined,
      startAt = 0;
    for (let page = 0; page < 5; page++) {
      const data = await this.transport.request(
        this.api + (this.deployment === 'cloud' ? '/search/jql' : '/search'),
        {
          method: 'POST',
          retryRead: true,
          body: {
            jql,
            maxResults: 50,
            fields: ['summary', 'project'],
            ...(this.deployment === 'cloud' ? { nextPageToken } : { startAt }),
          },
        },
      );
      if (!Array.isArray(data.issues))
        throw new ConnectorError('invalid_provider_response', 'Missing issue collection', 502);
      for (const issue of data.issues) {
        const actualScope = String(issue.fields?.project?.id ?? '');
        if (actualScope !== scope && issue.fields?.project?.key !== scope)
          throw new ConnectorError(
            'scope_mismatch',
            'Provider returned an issue outside the requested project',
            502,
          );
        items.push({
          id: String(issue.id),
          key: issue.key,
          title: issue.fields?.summary ?? '',
          url: this.instance + '/browse/' + encodeURIComponent(issue.key),
          scopeId: actualScope,
        });
      }
      nextPageToken = data.nextPageToken;
      startAt += data.issues.length;
      if (
        this.deployment === 'cloud'
          ? !nextPageToken
          : data.issues.length === 0 || startAt >= data.total
      )
        return { items, complete: true, warnings: [] };
    }
    return { items, complete: false, warnings: ['Issue search pagination limit reached'] };
  }
  async read(id: string): Promise<RemoteResource> {
    const path = this.api + '/issue/' + identifier(id);
    const issue = await this.transport.request(
      path + query({ fields: 'summary,description,status,project,updated,issuetype' }),
    );
    if (
      !issue.id ||
      !issue.fields?.project?.id ||
      typeof issue.fields.summary !== 'string' ||
      !issue.fields.updated
    )
      throw new ConnectorError(
        'invalid_provider_response',
        'Incomplete issue identity/version',
        502,
      );
    const content =
      this.deployment === 'cloud'
        ? adfProjection(issue.fields.description)
        : opaqueProjection(String(issue.fields.description ?? ''), 'jira-wiki');
    let transitions: RemoteResource['transitions'] = [];
    try {
      const data = await this.transport.request(path + '/transitions?expand=transitions.fields');
      transitions = (data.transitions ?? []).map((t: any) => ({
        id: String(t.id),
        name: String(t.name),
        toStatusId: String(t.to?.id ?? ''),
        toStatusName: String(t.to?.name ?? ''),
        requiredFields: Object.keys(t.fields ?? {}).filter((k) => t.fields[k].required),
      }));
    } catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== 'provider_forbidden') throw error;
    }
    return {
      provider: 'jira',
      deployment: this.deployment,
      instance: this.instance,
      id: String(issue.id),
      key: issue.key,
      url: this.instance + '/browse/' + encodeURIComponent(issue.key),
      scopeId: String(issue.fields.project.id),
      scopeName: issue.fields.project.name,
      title: issue.fields.summary,
      version: String(issue.fields.updated),
      observedAt: new Date().toISOString(),
      fields: {
        title: issue.fields.summary,
        description: content.markdown,
        status: issue.fields.status?.name ?? '',
      },
      statusId: String(issue.fields.status?.id ?? ''),
      transitions,
      content,
      representation: this.deployment === 'cloud' ? 'adf' : 'wiki',
      draft: 'absent',
      provenance: { api: path, profile: this.capabilities.profile },
    };
  }
  async history(id: string): Promise<Page<HistoryEntry>> {
    if (this.deployment !== 'cloud')
      return {
        items: [],
        complete: false,
        warnings: ['Changelog pagination is not certified for this Data Center profile'],
      };
    const data = await this.transport.request(
      this.api + '/issue/' + identifier(id) + '/changelog?maxResults=100',
    );
    return {
      items: (data.values ?? []).map((v: any) => ({
        id: String(v.id),
        createdAt: v.created,
        author: v.author?.displayName,
        summary: (v.items ?? []).map((i: any) => String(i.field)).join(', '),
      })),
      complete: !!data.isLast,
      warnings: data.isLast ? [] : ['Further history is available in Jira'],
    };
  }
  override async apply(plan: IntegrationPlan): Promise<void> {
    if (!this.capabilities.remoteUpdate)
      throw new ConnectorError(
        'unsafe_remote_update',
        this.capabilities.blockedReasons.join('; '),
        409,
      );
    if (!plan.candidate.payload || !plan.comparison.coverage.complete)
      throw new ConnectorError('blocked_plan', 'Incomplete reviewed payload', 409);
    const payload = plan.candidate.payload as {
      fields?: Record<string, unknown>;
      transition?: { id: string };
    };
    if (payload.fields && Object.keys(payload.fields).length)
      await this.transport.request(this.api + '/issue/' + identifier(plan.resource.id), {
        method: 'PUT',
        body: { fields: payload.fields },
      });
    if (payload.transition)
      await this.transport.request(
        this.api + '/issue/' + identifier(plan.resource.id) + '/transitions',
        { method: 'POST', body: { transition: payload.transition } },
      );
  }
  candidate(request: PlanRequest, resource: RemoteResource): IntegrationPlan['candidate'] {
    if (request.direction === 'import')
      return {
        text: resource.content.markdown,
        title: resource.title,
        status: resource.fields.status,
      };
    const fields: Record<string, unknown> = {};
    if (request.fields.includes('title')) fields.summary = request.local.title ?? '';
    if (request.fields.includes('description'))
      fields.description = toAdf(markdownProjection(managedBody(request.local)));
    return {
      title: request.local.title,
      status: request.local.status,
      text: managedBody(request.local),
      payload: {
        fields,
        ...(request.fields.includes('status') ? { transition: { id: request.transitionId } } : {}),
      },
    };
  }
}
export class ConfluenceAdapter extends BaseAdapter {
  readonly capabilities: AdapterCapabilities;
  constructor(options: AdapterOptions) {
    super(options);
    this.capabilities = {
      provider: 'confluence',
      deployment: this.deployment,
      profile:
        this.deployment === 'cloud'
          ? 'confluence-cloud-v2-adf'
          : 'confluence-dc-rest-v1-storage-read',
      read: true,
      search: true,
      compare: true,
      import: true,
      export: true,
      remoteUpdate: false,
      fields: this.deployment === 'cloud' ? ['title', 'body'] : ['title'],
      representations: [this.deployment === 'cloud' ? 'adf' : 'storage'],
      concurrency: 'versioned-with-draft-risk',
      blockedReasons: [
        'Page updates may reconcile or overwrite a draft; no verified draft-safe mutation guarantee',
      ],
      liveVerified: false,
    };
  }
  async identity() {
    const user = await this.transport.request(
      (this.deployment === 'cloud' ? '/wiki' : '') + '/rest/api/user/current',
    );
    const id = user.accountId ?? user.userKey ?? user.username;
    if (!id || typeof user.displayName !== 'string')
      throw new ConnectorError(
        'invalid_identity',
        'Provider did not identify the authenticated account',
        502,
      );
    return { id: String(id), displayName: user.displayName as string };
  }
  async scopes(): Promise<Page<Scope>> {
    const items: Scope[] = [];
    let cursor: string | undefined,
      start = 0;
    const path = this.deployment === 'cloud' ? '/wiki/api/v2/spaces' : '/rest/api/space';
    for (let p = 0; p < 10; p++) {
      const data = await this.transport.request(
        path + query({ limit: 50, ...(this.deployment === 'cloud' ? { cursor } : { start }) }),
      );
      if (!Array.isArray(data.results))
        throw new ConnectorError('invalid_provider_response', 'Missing space collection', 502);
      items.push(
        ...data.results.map((s: any) => ({
          id: String(s.id ?? s.key),
          name: String(s.name),
          key: s.key,
        })),
      );
      if (!data._links?.next) return { items, complete: true, warnings: [] };
      if (this.deployment === 'cloud') cursor = this.nextCursor(data._links.next, path);
      else start += data.results.length;
      if (!data.results.length)
        throw new ConnectorError('invalid_pagination', 'Empty page has a continuation', 502);
    }
    return { items, complete: false, warnings: ['Space pagination limit reached'] };
  }
  async search(scope: string, text: string): Promise<Page<ResourceSummary>> {
    identifier(scope);
    if (text.length > 300) throw new ConnectorError('invalid_query', 'Search is too long');
    const items: ResourceSummary[] = [];
    let cursor: string | undefined,
      start = 0;
    const path = this.deployment === 'cloud' ? '/wiki/api/v2/pages' : '/rest/api/content';
    for (let p = 0; p < 5; p++) {
      const data = await this.transport.request(
        path +
          query(
            this.deployment === 'cloud'
              ? {
                  'space-id': scope,
                  title: text || undefined,
                  status: 'current',
                  limit: 50,
                  cursor,
                }
              : {
                  spaceKey: scope,
                  title: text || undefined,
                  type: 'page',
                  status: 'current',
                  expand: 'version,space',
                  limit: 50,
                  start,
                },
          ),
      );
      if (!Array.isArray(data.results))
        throw new ConnectorError('invalid_provider_response', 'Missing page collection', 502);
      for (const page of data.results) {
        const identity = page.spaceId ?? page.space?.id ?? page.space?.key;
        if (!identity)
          throw new ConnectorError(
            'scope_missing',
            'Provider page has no verifiable space identity',
            502,
          );
        const scopeId = String(identity);
        if (scopeId !== scope && page.space?.key !== scope)
          throw new ConnectorError(
            'scope_mismatch',
            'Provider returned a page outside the requested space',
            502,
          );
        items.push({
          id: String(page.id),
          title: String(page.title),
          url: this.pageUrl(String(page.id)),
          scopeId,
          version: String(page.version?.number ?? ''),
        });
      }
      if (!data._links?.next) return { items, complete: true, warnings: [] };
      if (this.deployment === 'cloud') cursor = this.nextCursor(data._links.next, path);
      else start += data.results.length;
      if (!data.results.length)
        throw new ConnectorError('invalid_pagination', 'Empty page has a continuation', 502);
    }
    return { items, complete: false, warnings: ['Page pagination limit reached'] };
  }
  private pageUrl(id: string) {
    return (
      this.instance +
      (this.deployment === 'cloud' ? '/wiki' : '') +
      '/pages/viewpage.action?pageId=' +
      encodeURIComponent(id)
    );
  }
  async read(id: string): Promise<RemoteResource> {
    const path =
      this.deployment === 'cloud'
        ? '/wiki/api/v2/pages/' + identifier(id)
        : '/rest/api/content/' + identifier(id);
    const page = await this.transport.request(
      path +
        (this.deployment === 'cloud'
          ? '?body-format=atlas_doc_format&status=current'
          : '?expand=body.storage,version,space&status=current'),
    );
    if (
      !page.id ||
      !page.version?.number ||
      typeof page.title !== 'string' ||
      !(page.spaceId ?? page.space?.id ?? page.space?.key)
    )
      throw new ConnectorError(
        'invalid_provider_response',
        'Incomplete page identity/version',
        502,
      );
    let adf: unknown;
    try {
      adf =
        typeof page.body?.atlas_doc_format?.value === 'string'
          ? JSON.parse(page.body.atlas_doc_format.value)
          : page.body?.atlas_doc_format?.value;
    } catch {
      throw new ConnectorError('invalid_provider_response', 'Invalid page ADF', 502);
    }
    const content =
      this.deployment === 'cloud'
        ? adfProjection(adf)
        : opaqueProjection(String(page.body?.storage?.value ?? ''), 'confluence-storage');
    if (this.deployment === 'cloud' && adf === undefined) {
      content.complete = false;
      content.unsupported.push('missing-page-body');
    }
    return {
      provider: 'confluence',
      deployment: this.deployment,
      instance: this.instance,
      id: String(page.id),
      url: this.pageUrl(String(page.id)),
      scopeId: String(page.spaceId ?? page.space?.id ?? page.space?.key),
      scopeName: page.space?.name,
      title: page.title,
      version: String(page.version.number),
      observedAt: new Date().toISOString(),
      fields: { title: page.title, body: content.markdown },
      content,
      representation: this.deployment === 'cloud' ? 'adf' : 'storage',
      draft: page.status === 'draft' ? 'present' : 'unknown',
      provenance: { api: path, profile: this.capabilities.profile },
    };
  }
  async history(id: string): Promise<Page<HistoryEntry>> {
    if (this.deployment !== 'cloud')
      return {
        items: [],
        complete: false,
        warnings: ['Version history is not certified for this Data Center profile'],
      };
    const data = await this.transport.request(
      '/wiki/api/v2/pages/' + identifier(id) + '/versions?limit=100',
    );
    return {
      items: (data.results ?? []).map((v: any) => ({
        id: String(v.number),
        version: String(v.number),
        createdAt: v.createdAt,
        author: v.authorId,
        summary: String(v.message ?? ''),
      })),
      complete: !data._links?.next,
      warnings: data._links?.next ? ['Further versions are available in Confluence'] : [],
    };
  }
  override async apply(plan: IntegrationPlan): Promise<void> {
    if (!this.capabilities.remoteUpdate || plan.resource.draft !== 'absent')
      throw new ConnectorError(
        'unsafe_remote_update',
        this.capabilities.blockedReasons.join('; '),
        409,
      );
    if (!plan.candidate.payload || !plan.comparison.coverage.complete || plan.transportLoss.length)
      throw new ConnectorError('blocked_plan', 'Incomplete reviewed payload', 409);
    await this.transport.request('/wiki/api/v2/pages/' + identifier(plan.resource.id), {
      method: 'PUT',
      body: plan.candidate.payload,
    });
  }
  candidate(request: PlanRequest, resource: RemoteResource): IntegrationPlan['candidate'] {
    if (request.direction === 'import')
      return { text: resource.content.markdown, title: resource.title };
    return {
      text: managedBody(request.local),
      title: request.local.title,
      payload: {
        id: resource.id,
        status: 'current',
        title: request.fields.includes('title') ? request.local.title : resource.title,
        version: { number: Number(resource.version) + 1 },
        ...(request.fields.includes('body')
          ? {
              body: {
                representation: 'atlas_doc_format',
                value: JSON.stringify(toAdf(markdownProjection(managedBody(request.local)))),
              },
            }
          : {}),
      },
    };
  }
}
