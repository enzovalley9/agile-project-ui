import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectorHealth,
  validateConnectorHealth,
} from '../../../packages/connectors/src/protocol';
import { GitClient } from '../src/services/git-client';
import { AtlassianClient } from '../src/services/atlassian-client';
import { ProjectStore } from '../src/services/project-store';
import { memoryDirectory } from '../../../tests/support/memory-handles';

afterEach(() => vi.unstubAllGlobals());
describe('connector compatibility boundary', () => {
  it.each(['git', 'jira', 'confluence'] as const)(
    'accepts protocol 1 for %s without coupling release versions',
    (provider) => {
      expect(
        validateConnectorHealth({ ...connectorHealth(provider), version: '0.1.0' }, provider),
      ).toMatchObject({ provider, protocol: 1, version: '0.1.0', legacyVersion: false });
      expect(
        validateConnectorHealth({ ...connectorHealth(provider), version: '4.2.0-beta.1' }, provider)
          .protocol,
      ).toBe(1);
    },
  );
  it.each(['jira', 'confluence'] as const)(
    'recognizes the exact released versionless %s shape',
    (provider) => {
      expect(
        validateConnectorHealth(
          {
            ok: true,
            product: 'Agile Project UI Atlassian Connector',
            provider,
            protocolVersion: 1,
          },
          provider,
        ),
      ).toMatchObject({ provider, version: '0.1.0', legacyVersion: true });
      expect(() =>
        validateConnectorHealth(
          { product: 'Agile Project UI Atlassian Connector', provider, protocolVersion: 1 },
          provider,
        ),
      ).toThrow(/ready health state/);
    },
  );
  it.each([
    null,
    [],
    {},
    { ...connectorHealth('git'), version: 42 },
    { ...connectorHealth('git'), version: 'latest' },
    { ...connectorHealth('git'), version: undefined },
    { ...connectorHealth('git'), protocol: '1' },
    { ...connectorHealth('git'), protocol: 2 },
    { ...connectorHealth('git'), product: 'Other service' },
  ])('rejects malformed or incompatible Git metadata: %j', (health) => {
    expect(() => validateConnectorHealth(health, 'git')).toThrow();
  });
  it.each([false, undefined, 'true'])('rejects malformed Atlassian readiness: %j', (ok) => {
    expect(() => validateConnectorHealth({ ...connectorHealth('jira'), ok }, 'jira')).toThrow(
      /ready health state/,
    );
  });
  it('rejects the wrong Atlassian provider', () => {
    expect(() => validateConnectorHealth(connectorHealth('jira'), 'confluence')).toThrow(
      /different connector/,
    );
  });
  it('rejects an unsupported Git connector before a capability or temporary binding is sent', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ...connectorHealth('git'), protocol: 2 }),
    );
    vi.stubGlobal('fetch', fetch);
    const store = new ProjectStore(memoryDirectory({ 'docs/a.md': 'Original' }).handle);
    await store.setMode('edit');
    const client = new GitClient();
    await expect(client.connect(store, 'never-transmit-this-fixture', true)).rejects.toMatchObject({
      code: 'CONNECTOR_PROTOCOL',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:43120/v1/health');
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({});
  });
  it.each(['jira', 'confluence'] as const)(
    'refuses %s authorization before sending credentials to the wrong service',
    async (provider) => {
      const requests: { url: string; init?: RequestInit }[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return Response.json(connectorHealth('git'));
      });
      await expect(
        new AtlassianClient(provider).authorize('never-transmit-this-fixture'),
      ).rejects.toThrow(/different connector/);
      expect(requests.map((r) => r.url)).toEqual([
        `http://127.0.0.1:${provider === 'jira' ? 43121 : 43122}/v1/health`,
      ]);
      expect(requests[0]?.init?.headers).toEqual({});
    },
  );
  it.each(['read', 'mutate'])(
    'rechecks protocol before a %s after a connector is replaced',
    async (operation) => {
      let health: Record<string, unknown> = connectorHealth('jira');
      const paths: string[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === '/v1/health') {
          expect(init?.headers).toEqual({});
          return Response.json(health);
        }
        return Response.json({
          sessionToken: 'fixture-session',
          provider: 'jira',
          instance: 'https://example.invalid',
        });
      });
      const client = new AtlassianClient('jira');
      await client.authorize('fixture-launcher');
      health = { ...health, protocolVersion: 2 };
      await expect(
        operation === 'read' ? client.scopes() : client.apply('fixture-plan'),
      ).rejects.toThrow(/unsupported/);
      expect(paths).not.toContain('/v1/scopes');
      expect(paths).not.toContain('/v1/operations');
      expect(client.healthInfo).toBeUndefined();
    },
  );
});
