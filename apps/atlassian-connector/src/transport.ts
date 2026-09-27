export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly operationId?: string,
  ) {
    super(message);
  }
}
export interface TransportOptions {
  instance: string;
  authorization: string;
  allowHttpLoopbackForTests?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}
export function normalizeInstance(raw: string, allowHttp = false): string {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes('..') ||
    url.pathname.includes('%')
  )
    throw new ConnectorError('invalid_instance', 'Instance must be an exact base URL');
  if (
    url.protocol !== 'https:' &&
    !(allowHttp && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new ConnectorError('invalid_instance', 'An HTTPS instance is required');
  return url.href.replace(/\/$/, '');
}
export class ProviderTransport {
  readonly instance: string;
  constructor(private options: TransportOptions) {
    this.instance = normalizeInstance(options.instance, options.allowHttpLoopbackForTests);
    if (!options.authorization || /[\r\n]/.test(options.authorization))
      throw new ConnectorError('invalid_credentials', 'Provider authorization is required');
  }
  async request<T = any>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
      headers?: Record<string, string>;
      retryRead?: boolean;
    } = {},
  ): Promise<T> {
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      /[\r\n\\]/.test(path)
    )
      throw new ConnectorError('invalid_provider_path', 'Invalid adapter request');
    const method = options.method ?? 'GET';
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(this.instance + path, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: this.options.authorization,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
        });
      } catch {
        throw new ConnectorError(
          method === 'GET' ? 'provider_unavailable' : 'outcome_unknown',
          method === 'GET'
            ? 'The provider did not return a readable response'
            : 'The request outcome is unknown; reconcile before any further action',
          502,
        );
      }
      if (
        [429, 502, 503, 504].includes(response.status) &&
        (method === 'GET' || options.retryRead) &&
        attempt < 1
      ) {
        const retry = response.headers.get('retry-after');
        const seconds = retry ? Number(retry) : 0.1;
        await response.body?.cancel();
        if (!Number.isFinite(seconds) || seconds > 2)
          throw new ConnectorError('rate_limited', 'The provider requested a later retry', 429);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ConnectorError('provider_redirect', 'Provider redirects are not followed', 502);
      }
      if (!response.ok) {
        await response.body?.cancel();
        const code =
          response.status === 401
            ? 'provider_auth_expired'
            : response.status === 403
              ? 'provider_forbidden'
              : response.status === 404
                ? 'provider_not_found'
                : response.status === 409 || response.status === 412
                  ? 'remote_stale'
                  : response.status === 429
                    ? 'rate_limited'
                    : 'provider_error';
        throw new ConnectorError(
          code,
          `Provider returned HTTP ${response.status}`,
          response.status === 401 || response.status === 403
            ? 403
            : response.status === 404
              ? 404
              : response.status === 409 || response.status === 412
                ? 409
                : 502,
        );
      }
      const max = this.options.maxBytes ?? 2 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > max) {
        await response.body?.cancel();
        throw new ConnectorError(
          'response_too_large',
          'Provider response exceeds the configured limit',
          502,
        );
      }
      const reader = response.body?.getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > max) {
            await reader.cancel();
            throw new ConnectorError(
              'response_too_large',
              'Provider response exceeds the configured limit',
              502,
            );
          }
          parts.push(value);
        }
      if (!length) return {} as T;
      const bytes = Buffer.concat(parts);
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
      } catch {
        throw new ConnectorError(
          'invalid_provider_response',
          'Provider returned invalid JSON',
          502,
        );
      }
    }
  }
}
export function identifier(raw: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(raw))
    throw new ConnectorError('invalid_id', 'Invalid resource or scope identifier');
  return encodeURIComponent(raw);
}
export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  return '?' + q.toString();
}
