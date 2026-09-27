import {
  validateConnectorHealth,
  type ConnectorHealth,
} from '../../../../packages/connectors/src/protocol';
import type {
  Provider,
  AdapterCapabilities,
  Scope,
  ResourceSummary,
  Page,
  RemoteResource,
  HistoryEntry,
  PlanRequest,
  IntegrationPlan,
  IntegrationOperation,
} from '../../../../packages/integrations/src/types';
export * from '../../../../packages/integrations/src/types';
export class AtlassianClient {
  private token = '';
  healthInfo?: ConnectorHealth;
  instance = '';
  identity?: { id: string; displayName: string };
  readonly baseUrl: string;
  constructor(
    readonly provider: Provider,
    url = `http://127.0.0.1:${provider === 'jira' ? 43121 : 43122}`,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('The connector must use a local HTTP address without a path or credentials.');
    this.baseUrl = parsed.origin;
  }
  get connected() {
    return !!this.token && !!this.instance;
  }
  private async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    if (path !== '/v1/health') {
      try {
        await this.health();
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          String(error.code).startsWith('CONNECTOR_')
        )
          throw error;
        throw Object.assign(
          new Error(
            'The connector health check failed before the request was sent. Check the local service and try again.',
          ),
          { code: 'CONNECTOR_PREFLIGHT' },
        );
      }
    }
    const headers: Record<string, string> = {};
    if (this.token && path !== '/v1/health') headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path === '/v1/operations' ? 125000 : 25000),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new Error(
        'No response was received from the connector. Keep the plan and check its result before repeating an operation.',
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(data?.error?.message ?? 'The connector rejected the request.'),
        { code: data?.error?.code, operationId: data?.error?.operationId },
      );
    return data;
  }
  async health() {
    this.healthInfo = undefined;
    return (this.healthInfo = validateConnectorHealth(
      await this.request<unknown>('/v1/health'),
      this.provider,
    ));
  }
  async authorize(launcherToken: string) {
    await this.health();
    this.token = launcherToken;
    try {
      const result = await this.request<{
        sessionToken: string;
        expiresAt: string;
        provider: Provider;
        instance: string;
        capabilities: AdapterCapabilities;
        identity: { id: string; displayName: string };
      }>('/v1/session', {});
      if (result.provider !== this.provider)
        throw new Error('The connected service does not match this integration.');
      this.token = result.sessionToken;
      this.instance = result.instance;
      this.identity = result.identity;
      return result;
    } catch (e) {
      this.token = '';
      this.instance = '';
      this.identity = undefined;
      throw e;
    }
  }
  async disconnect() {
    try {
      if (this.token) await this.request('/v1/session', undefined, 'DELETE');
    } finally {
      this.token = '';
      this.instance = '';
      this.identity = undefined;
    }
  }
  capabilities() {
    return this.request<AdapterCapabilities>('/v1/capabilities');
  }
  scopes() {
    return this.request<Page<Scope>>('/v1/scopes');
  }
  search(scope: string, q: string) {
    return this.request<Page<ResourceSummary>>(
      `/v1/search?scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}`,
    );
  }
  resource(id: string) {
    return this.request<RemoteResource>('/v1/resources/' + encodeURIComponent(id));
  }
  history(id: string) {
    return this.request<Page<HistoryEntry>>('/v1/resources/' + encodeURIComponent(id) + '/history');
  }
  plan(request: PlanRequest) {
    return this.request<IntegrationPlan>('/v1/plans', request);
  }
  apply(planId: string) {
    return this.request<IntegrationOperation>('/v1/operations', { planId });
  }
  pendingOperations() {
    return this.request<Page<IntegrationOperation>>('/v1/operations');
  }
  operationByPlan(planId: string) {
    return this.request<IntegrationOperation>(
      '/v1/operations/by-plan/' + encodeURIComponent(planId),
    );
  }
  reconcile(id: string) {
    return this.request<IntegrationOperation>(
      '/v1/operations/' + encodeURIComponent(id) + '/reconcile',
      {},
    );
  }
}
