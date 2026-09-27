import { canonicalText, markdownProjection, splitFrontmatter } from './content';
import type {
  Comparison,
  ComparisonBase,
  ComparisonState,
  LocalResource,
  ManagedField,
  RemoteResource,
} from './types';
export function managedBody(local: LocalResource): string {
  const body = splitFrontmatter(local.text).body;
  const heading = body.match(/^\s*# ([^\r\n]+)(?:\r?\n|$)/);
  return !local.entityId && local.title && heading?.[1] === local.title
    ? body.slice(heading[0].length).replace(/^\s*\n/, '')
    : body;
}
export function localFields(local: LocalResource): Partial<Record<ManagedField, string>> {
  const body = managedBody(local);
  return { title: local.title ?? '', status: local.status ?? '', description: body, body };
}
export function fieldEqual(field: ManagedField, a: string, b: string): boolean {
  return field === 'body' || field === 'description'
    ? canonicalText(a).value === canonicalText(b).value
    : a === b;
}
export function compareResource(
  local: LocalResource,
  remote: RemoteResource,
  fields: ManagedField[],
  base?: ComparisonBase,
): Comparison {
  if (
    base &&
    (base.normalizerVersion !== 1 ||
      base.schemaVersion !== 1 ||
      base.provider !== remote.provider ||
      base.instance !== remote.instance ||
      base.resourceId !== remote.id)
  )
    throw new Error('Comparison base belongs to a different resource or normalizer');
  const values = localFields(local);
  const bodySelected = fields.some((f) => f === 'body' || f === 'description');
  const localContent = markdownProjection(managedBody(local));
  const unsupported = bodySelected
    ? [...localContent.unsupported, ...remote.content.unsupported]
    : [];
  const rows = fields.map((field) => {
    const l = values[field] ?? '',
      r = remote.fields[field] ?? '';
    const comparable =
      !(field === 'body' || field === 'description') ||
      (localContent.complete && remote.content.complete);
    const bl = base?.local[field],
      br = base?.remote[field];
    let state: ComparisonState;
    if (!comparable) state = 'partial';
    else if (fieldEqual(field, l, r))
      state =
        bl !== undefined &&
        br !== undefined &&
        (!fieldEqual(field, l, bl) || !fieldEqual(field, r, br))
          ? 'convergent'
          : 'equal';
    else if (bl === undefined || br === undefined) state = 'no-base';
    else {
      const lc = !fieldEqual(field, l, bl),
        rc = !fieldEqual(field, r, br);
      state = lc && rc ? 'both-changed' : lc ? 'local-changes' : rc ? 'remote-changes' : 'no-base';
    }
    return { field, local: l, remote: r, baseLocal: bl, baseRemote: br, state, comparable };
  });
  const states = rows.map((r) => r.state);
  const state: ComparisonState = states.includes('partial')
    ? 'partial'
    : states.includes('both-changed') ||
        (states.includes('local-changes') && states.includes('remote-changes'))
      ? 'both-changed'
      : states.includes('no-base')
        ? 'no-base'
        : states.includes('local-changes')
          ? 'local-changes'
          : states.includes('remote-changes')
            ? 'remote-changes'
            : states.includes('convergent')
              ? 'convergent'
              : 'equal';
  return {
    state,
    rows,
    coverage: { complete: unsupported.length === 0, unsupported: [...new Set(unsupported)] },
    observedAt: remote.observedAt,
    normalizerVersion: 1,
  };
}
export function captureBase(local: LocalResource, remote: RemoteResource): ComparisonBase {
  return {
    schemaVersion: 1,
    normalizerVersion: 1,
    provider: remote.provider,
    instance: remote.instance,
    resourceId: remote.id,
    local: localFields(local),
    remote: { ...remote.fields },
    observedAt: remote.observedAt,
  };
}
