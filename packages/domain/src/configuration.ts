import { parse as parseToml } from 'smol-toml';
import type { Diagnostic, DiscoveredRoot, FileSnapshot, IndexOptions } from './types';
import { isRecord, isSafePath, parseYaml, safeRecord, textValue } from './source';

const TOML_LAYERS = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
];
const badKeys = new Set(['__proto__', 'constructor', 'prototype']);
export function mergeConfiguration(base: unknown, incoming: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const identified = [...base, ...incoming].every(
      (value) =>
        isRecord(value) && (typeof value.code === 'string' || typeof value.id === 'string'),
    );
    if (!identified) return [...base, ...incoming];
    const values = [...base];
    for (const value of incoming) {
      const key = value.code ?? value.id;
      const index = values.findIndex((entry) => (entry.code ?? entry.id) === key);
      if (index >= 0) values[index] = value;
      else values.push(value);
    }
    return values;
  }
  if (isRecord(base) && isRecord(incoming)) {
    const result: Record<string, unknown> = Object.assign(Object.create(null), base);
    for (const [key, value] of Object.entries(incoming))
      if (!badKeys.has(key))
        result[key] = Object.hasOwn(result, key) ? mergeConfiguration(result[key], value) : value;
    return result;
  }
  return incoming;
}
export interface Configuration {
  name: string;
  version?: string;
  roots: DiscoveredRoot[];
  effective: Record<string, unknown>;
  manifest: Record<string, unknown>;
  provenance: Record<string, string>;
  customizedAgents: Set<string>;
}
export function discoverConfiguration(
  files: FileSnapshot,
  diagnostics: Diagnostic[],
  options: IndexOptions,
  documentFiles: FileSnapshot = files,
): Configuration {
  const roots: DiscoveredRoot[] = [];
  const provenance: Record<string, string> = Object.create(null);
  let effective: Record<string, unknown> = {};
  const customizedAgents = new Set<string>();
  for (const path of TOML_LAYERS) {
    if (!Object.hasOwn(files, path)) continue;
    try {
      const value = parseToml(files[path], {
        unsafeKeyBehaviour: 'throw',
        integersAsBigInt: 'asNeeded',
      }) as Record<string, unknown>;
      effective = mergeConfiguration(effective, value) as Record<string, unknown>;
      for (const code of Object.keys(safeRecord(value.agents))) {
        provenance[`agents.${code}`] = path;
        if (path !== TOML_LAYERS[0]) customizedAgents.add(code);
      }
      for (const key of Object.keys(safeRecord(value.core))) provenance[`core.${key}`] = path;
      for (const key of Object.keys(safeRecord(safeRecord(value.modules).bmm)))
        provenance[`bmm.${key}`] = path;
    } catch {
      diagnostics.push({
        code: 'invalid-toml',
        severity: 'error',
        path,
        message:
          'Cannot parse the TOML configuration. Potentially private configuration content is not displayed.',
      });
    }
  }
  const manifestPath = '_bmad/_config/manifest.yaml';
  const manifest = Object.hasOwn(files, manifestPath)
    ? safeRecord(parseYaml(files[manifestPath], manifestPath, diagnostics).data)
    : {};
  const version = textValue(safeRecord(manifest.installation).version);
  if (
    !options.localInstallationPresent &&
    !Object.keys(files).some((path) => path.startsWith('_bmad/'))
  )
    diagnostics.push({
      code: 'installation-absent',
      severity: 'info',
      message: 'No BMAD installation was detected. Available project documents are still indexed.',
    });
  else if (!version)
    diagnostics.push({
      code: 'version-unknown',
      severity: 'info',
      message:
        'No installation version is declared. Available features depend on the detected formats.',
    });
  else if (version !== '6.12.0')
    diagnostics.push({
      code: 'version-unsupported',
      severity: 'warning',
      path: manifestPath,
      message: `Declared version ${version}: the tested reference is 6.12.0. Known formats are identified by content.`,
    });
  const core = safeRecord(effective.core),
    module = safeRecord(safeRecord(effective.modules).bmm);
  let name = textValue(core.project_name) || options.projectName || 'Local project';
  const families: { source: string; values: Record<string, unknown> }[] = [];
  if (Object.keys(effective).length)
    families.push({ source: 'TOML', values: { ...core, ...module } });
  for (const code of ['bmm', 'core']) {
    const path = `_bmad/${code}/config.yaml`;
    const customPath = `_bmad/${code}/config.user.yaml`;
    if (!Object.hasOwn(files, path)) continue;
    const base = parseYaml(files[path], path, diagnostics);
    let values = safeRecord(base.data);
    if (Object.hasOwn(files, customPath))
      values = mergeConfiguration(
        values,
        safeRecord(parseYaml(files[customPath], customPath, diagnostics).data),
      ) as Record<string, unknown>;
    families.push({ source: path, values });
    if (name === 'Local project') name = textValue(values.project_name) || name;
  }
  if (!families.length)
    families.push({ source: 'convention without verified configuration', values: {} });
  const rootFields = {
    output_folder: 'output',
    planning_artifacts: 'planning',
    implementation_artifacts: 'implementation',
    project_knowledge: 'knowledge',
  } as const;
  const defaults: Record<string, string> = {
    output_folder: '{project-root}/_bmad-output',
    planning_artifacts: '{output_folder}/planning-artifacts',
    implementation_artifacts: '{output_folder}/implementation-artifacts',
    project_knowledge: '{project-root}/docs',
  };
  const byRole = new Map<string, Set<string>>();
  for (const family of families) {
    const values = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(family.values).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };
    function resolve(key: string, stack: string[] = []): string | undefined {
      if (stack.includes(key) || stack.length > 12 || !(key in values)) return;
      let failed = false;
      const raw = values[key];
      const resolved = raw.replace(/\{([^{}]+)\}/g, (_, token: string) => {
        if (token === 'project-root') return '__BMAD_ROOT__';
        if (!(token in rootFields)) {
          failed = true;
          return '';
        }
        const result = resolve(token, [...stack, key]);
        if (result === undefined) failed = true;
        return result || '';
      });
      if (failed) return;
      const relative = resolved.replace(/^__BMAD_ROOT__\/?/, '').replace(/\/$/, '');
      if (
        relative.includes('__BMAD_ROOT__') ||
        relative.includes('{') ||
        (!relative && key !== 'output_folder') ||
        (relative && !isSafePath(relative))
      )
        return;
      return relative;
    }
    for (const [key, role] of Object.entries(rootFields) as [
      keyof typeof rootFields,
      DiscoveredRoot['role'],
    ][]) {
      const raw = values[key];
      const resolved = resolve(key);
      const projectPath = options.sharedInstallation?.projectRelativePath;
      const path =
        resolved === undefined || !projectPath
          ? resolved
          : resolved === projectPath
            ? ''
            : resolved.startsWith(`${projectPath}/`)
              ? resolved.slice(projectPath.length + 1)
              : undefined;
      if (path === undefined) {
        const outsideProject = resolved !== undefined && projectPath !== undefined;
        diagnostics.push({
          code: outsideProject ? 'shared-root-outside-project' : 'unresolved-root',
          severity: 'warning',
          path: family.source,
          message: outsideProject
            ? `Path ${key} is outside the selected project; it is retained as unsupported configuration.`
            : `Path ${key} cannot be resolved within the project; it is retained as unsupported configuration.`,
        });
        continue;
      }
      const exists = Object.keys(documentFiles).some(
        (file) => !path || file.startsWith(`${path}/`),
      );
      if (!roots.some((root) => root.path === path && root.role === role))
        roots.push({ path, role, source: family.source, raw, exists });
      const paths = byRole.get(role) || new Set();
      paths.add(path);
      byRole.set(role, paths);
    }
  }
  for (const [role, paths] of byRole)
    if (paths.size > 1)
      diagnostics.push({
        code: 'configuration-divergent',
        severity: 'warning',
        message: `Configurations resolve different ${role} roots. All candidates are shown without modifying BMAD.`,
        relatedPaths: [...paths],
      });
  for (const path of options.additionalRoots || []) {
    if (!isSafePath(path)) {
      diagnostics.push({
        code: 'unsafe-root',
        severity: 'error',
        path,
        message: 'The document folder must remain within the authorized project.',
      });
      continue;
    }
    if (!roots.some((root) => root.path === path))
      roots.push({
        path,
        role: 'additional',
        source: 'explicit selection',
        raw: path,
        exists: Object.keys(documentFiles).some((file) => file.startsWith(path + '/')),
      });
  }
  return { name, version, roots, effective, manifest, provenance, customizedAgents };
}
