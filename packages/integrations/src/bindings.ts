import type { IntegrationBinding, ManagedField } from './types';
export function safeLocalPath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith('/') &&
    !/^[a-z]:/i.test(path) &&
    !path.includes('\\') &&
    !path.split('/').some((s) => !s || s === '.' || s === '..' || s === '.git') &&
    !/[\u0000-\u001f]/.test(path)
  );
}
export function validateBinding(raw: unknown): IntegrationBinding {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid binding');
  const b = raw as IntegrationBinding;
  if (
    b.schemaVersion !== 1 ||
    b.normalizerVersion !== 1 ||
    !['jira', 'confluence'].includes(b.provider) ||
    !['cloud', 'data-center'].includes(b.deployment) ||
    !b.id ||
    !b.projectId ||
    !b.resourceId ||
    !b.scopeId ||
    !b.local ||
    !safeLocalPath(b.local.path)
  )
    throw new Error('Invalid binding identity or local path');
  const instance = new URL(b.instance),
    resource = new URL(b.resourceUrl);
  if (
    instance.protocol !== 'https:' ||
    instance.username ||
    instance.password ||
    instance.search ||
    instance.hash ||
    resource.origin !== instance.origin ||
    resource.username ||
    resource.password
  )
    throw new Error('Binding requires a matching HTTPS instance');
  if (
    !Array.isArray(b.fields) ||
    !b.fields.length ||
    b.fields.some(
      (f) => !(['title', 'description', 'body', 'status'] as ManagedField[]).includes(f),
    ) ||
    new Set(b.fields).size !== b.fields.length
  )
    throw new Error('Invalid managed fields');
  if (!['review-both-directions', 'publish-only', 'import-only'].includes(b.policy))
    throw new Error('Invalid mapping policy');
  if (b.local.section && (!b.local.section.heading || !b.local.section.revision))
    throw new Error('Section mapping needs heading and revision');
  if (b.feature) {
    const f = new URL(b.feature.instance);
    if (f.protocol !== 'https:' || f.username || f.password || !b.feature.issueId)
      throw new Error('Invalid feature association');
  }
  if (
    Object.keys(b.local).some((k) => !['path', 'entityId', 'kind', 'section'].includes(k)) ||
    (b.local.section &&
      Object.keys(b.local.section).some((k) => !['heading', 'revision'].includes(k))) ||
    (b.feature && Object.keys(b.feature).some((k) => !['instance', 'issueId', 'key'].includes(k)))
  )
    throw new Error('Unexpected nested binding fields');
  const allowed = new Set([
    'schemaVersion',
    'normalizerVersion',
    'id',
    'projectId',
    'provider',
    'deployment',
    'instance',
    'resourceId',
    'resourceKey',
    'resourceUrl',
    'scopeId',
    'local',
    'fields',
    'policy',
    'feature',
  ]);
  if (Object.keys(raw).some((k) => !allowed.has(k))) throw new Error('Unexpected binding fields');
  return structuredClone(b);
}
export function validateBindings(raw: unknown): IntegrationBinding[] {
  if (!Array.isArray(raw) || raw.length > 10000) throw new Error('Invalid binding collection');
  const bindings = raw.map(validateBinding),
    seen = new Set<string>();
  for (const b of bindings) {
    const key = [
      b.projectId,
      b.provider,
      b.instance,
      b.resourceId,
      b.local.path,
      b.local.entityId ?? '',
      b.local.section?.heading ?? '',
    ].join('\0');
    if (seen.has(key)) throw new Error('Duplicate mapping');
    seen.add(key);
  }
  return bindings;
}
