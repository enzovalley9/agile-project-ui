import { version } from '../../../package.json';

export const CONNECTOR_VERSION = version;
export const CONNECTOR_PROTOCOL = 1;
export type ConnectorKind = 'git' | 'jira' | 'confluence';
export interface ConnectorHealth {
  product: string;
  provider: ConnectorKind;
  protocol: number;
  version: string;
  legacyVersion: boolean;
}

/** Published protocol 1 remains supported independently of the web release version. */
export function connectorHealth(provider: ConnectorKind) {
  return provider === 'git'
    ? { product: 'Agile Project UI Git Connector', protocol: CONNECTOR_PROTOCOL, version }
    : {
        ok: true,
        product: 'Agile Project UI Atlassian Connector',
        provider,
        protocolVersion: CONNECTOR_PROTOCOL,
        version,
      };
}

export function validateConnectorHealth(value: unknown, provider: ConnectorKind): ConnectorHealth {
  const fail = (code: string, message: string): never => {
    throw Object.assign(
      new Error(
        message +
          ' Open the connector installation guide to update or roll back; no operation has been sent.',
      ),
      { code },
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('CONNECTOR_PROTOCOL', 'The local service returned malformed health information.');
  const health = value as Record<string, unknown>;
  const product =
    provider === 'git' ? 'Agile Project UI Git Connector' : 'Agile Project UI Atlassian Connector';
  if (health.product !== product || (provider !== 'git' && health.provider !== provider))
    return fail('CONNECTOR_PRODUCT', 'This address belongs to a different connector.');
  if (provider !== 'git' && health.ok !== true)
    return fail('CONNECTOR_PROTOCOL', 'The connector did not report a ready health state.');
  const protocol = provider === 'git' ? health.protocol : health.protocolVersion;
  if (protocol !== CONNECTOR_PROTOCOL)
    return fail(
      'CONNECTOR_PROTOCOL',
      'The connector protocol is unsupported by this web app (supported: 1).',
    );
  // The original Atlassian 0.1.0 release had no version field. Its exact product,
  // provider and protocol tuple is the only supported versionless legacy shape.
  const legacyVersion = provider !== 'git' && health.version === undefined && health.ok === true;
  if (
    !legacyVersion &&
    (typeof health.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(health.version))
  )
    return fail('CONNECTOR_VERSION', 'The connector returned an invalid software version.');
  return {
    product,
    provider,
    protocol,
    version: legacyVersion ? '0.1.0' : (health.version as string),
    legacyVersion,
  };
}
