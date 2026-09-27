import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requiredJobs } from './release-contract.mjs';

export const launchTopics = [
  'agile',
  'bmad-method',
  'local-first',
  'markdown',
  'project-management',
  'react',
  'typescript',
  'self-hosted',
];
const actors = (value) => ({
  users: (value.users ?? []).map((user) => (typeof user === 'string' ? user : user.login)),
  teams: (value.teams ?? []).map((team) => (typeof team === 'string' ? team : team.slug)),
  apps: (value.apps ?? []).map((app) => (typeof app === 'string' ? app : app.slug)),
});
export function protectionPolicy(existing = {}) {
  const contexts = new Set([
    ...(existing.required_status_checks?.contexts ?? []),
    ...Object.keys(requiredJobs),
  ]);
  const previousChecks = existing.required_status_checks?.checks ?? [];
  return {
    required_status_checks: {
      strict: true,
      checks: [...contexts].sort().map((context) => ({
        context,
        app_id: previousChecks.find((check) => check.context === context)?.app_id ?? 15368,
      })),
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      require_code_owner_reviews:
        existing.required_pull_request_reviews?.require_code_owner_reviews ?? false,
      require_last_push_approval:
        existing.required_pull_request_reviews?.require_last_push_approval ?? false,
      ...(existing.required_pull_request_reviews?.dismissal_restrictions
        ? {
            dismissal_restrictions: actors(
              existing.required_pull_request_reviews.dismissal_restrictions,
            ),
          }
        : {}),
      ...(existing.required_pull_request_reviews?.bypass_pull_request_allowances
        ? {
            bypass_pull_request_allowances: actors(
              existing.required_pull_request_reviews.bypass_pull_request_allowances,
            ),
          }
        : {}),
      dismiss_stale_reviews: true,
      required_approving_review_count:
        existing.required_pull_request_reviews?.required_approving_review_count ?? 0,
    },
    restrictions: existing.restrictions
      ? {
          users: (existing.restrictions.users ?? []).map((user) => user.login),
          teams: (existing.restrictions.teams ?? []).map((team) => team.slug),
          apps: (existing.restrictions.apps ?? []).map((app) => app.slug),
        }
      : null,
    required_conversation_resolution: true,
    required_linear_history: existing.required_linear_history?.enabled ?? false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: existing.block_creations?.enabled ?? false,
    lock_branch: existing.lock_branch?.enabled ?? false,
    allow_fork_syncing: existing.allow_fork_syncing?.enabled ?? false,
  };
}
export const immutableTags = {
  name: 'Agile Project UI immutable version tags',
  target: 'tag',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'update' }],
};
export function assertVisibility(repo, name, expected) {
  if (
    repo.full_name !== name ||
    repo.default_branch !== 'main' ||
    repo.private !== (expected === 'private')
  )
    throw new Error(
      'Repository identity, main branch or expected visibility changed. No further settings will be applied.',
    );
}
function gh(method, endpoint, body, acceptable = []) {
  const result = spawnSync(
    'gh',
    ['api', '--method', method, endpoint, ...(body ? ['--input', '-'] : [])],
    {
      encoding: 'utf8',
      input: body ? JSON.stringify(body) : undefined,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  let value;
  try {
    value = result.stdout?.trim() ? JSON.parse(result.stdout) : null;
  } catch {
    throw new Error('Invalid GitHub API response.');
  }
  const status =
    result.status === 0
      ? 200
      : Number(value?.status ?? /HTTP (\d+)/.exec(result.stderr ?? '')?.[1]);
  if (result.status !== 0 && !acceptable.includes(status))
    throw new Error(
      `${method} ${endpoint} failed (HTTP ${status || 'unknown'}). Inspect GitHub permissions; no paid product is enabled by this script.`,
    );
  return { status, value };
}
export function configure(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      'expected-visibility': { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  const name = values.repo,
    expected = values['expected-visibility'];
  if (!/^[\w.-]+\/[\w.-]+$/.test(name ?? '') || !['private', 'public'].includes(expected))
    throw new Error(
      'Use --repo OWNER/REPO --expected-visibility private|public [--apply]. Visibility is never changed.',
    );
  const base = `repos/${name}`;
  const check = () => {
    const repo = gh('GET', base).value;
    assertVisibility(repo, name, expected);
    return repo;
  };
  const initial = check();
  const operations = [];
  const apply = (label, method, endpoint, body) => {
    operations.push(label);
    if (values.apply) {
      check();
      gh(method, endpoint, body);
      console.log(`Applied: ${label}`);
    }
  };
  apply('Dependency graph and vulnerability alerts', 'PUT', `${base}/vulnerability-alerts`);
  apply('Dependabot security update pull requests', 'PUT', `${base}/automated-security-fixes`);
  apply('Repository topics', 'PUT', `${base}/topics`, {
    names: [...new Set([...initial.topics, ...launchTopics])],
  });
  apply('Delete merged branches and retain manual merge control', 'PATCH', base, {
    delete_branch_on_merge: true,
    allow_auto_merge: false,
  });
  if (expected === 'public') {
    const existing = gh('GET', `${base}/branches/main/protection`, undefined, [404]).value;
    apply(
      'Required CI, reviewed pull requests and protected main',
      'PUT',
      `${base}/branches/main/protection`,
      protectionPolicy(existing?.message ? {} : (existing ?? {})),
    );
    const rules = gh('GET', `${base}/rulesets?per_page=100`).value;
    const match = rules.filter((rule) => rule.name === immutableTags.name);
    if (match.length > 1)
      throw new Error('Duplicate managed tag rulesets; inspect before applying.');
    apply(
      'Immutable version tags',
      match.length ? 'PUT' : 'POST',
      `${base}/rulesets${match.length ? `/${match[0].id}` : ''}`,
      immutableTags,
    );
    apply('Secret scanning and push protection', 'PATCH', base, {
      security_and_analysis: {
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: 'enabled' },
      },
    });
    apply('Private vulnerability reporting', 'PUT', `${base}/private-vulnerability-reporting`);
    apply('CodeQL default setup', 'PATCH', `${base}/code-scanning/default-setup`, {
      state: 'configured',
      languages: ['javascript-typescript', 'actions'],
      query_suite: 'default',
    });
  } else {
    console.log(
      'Prepared only: public branch/tag protections, CodeQL, secret scanning/push protection and private vulnerability reporting. Private Free feature availability is not assumed and no paid security product is enabled.',
    );
  }
  check();
  if (!values.apply)
    console.log(
      JSON.stringify({ repository: name, visibility: expected, plan: operations }, null, 2),
    );
  else {
    gh('GET', `${base}/vulnerability-alerts`);
    const fixes = gh('GET', `${base}/automated-security-fixes`).value;
    if (!fixes?.enabled) throw new Error('Security update enablement was not confirmed.');
    if (expected === 'public') {
      const actual = gh('GET', `${base}/branches/main/protection`).value;
      const contexts = actual.required_status_checks?.contexts ?? [];
      if (
        !Object.keys(requiredJobs).every((job) => contexts.includes(job)) ||
        actual.allow_force_pushes?.enabled ||
        actual.allow_deletions?.enabled ||
        !actual.enforce_admins?.enabled
      )
        throw new Error('Main protection readback differs from required policy.');
      const tags = gh('GET', `${base}/rulesets?per_page=100`).value.filter(
        (rule) => rule.name === immutableTags.name,
      );
      if (tags.length !== 1)
        throw new Error('Managed version-tag protection is missing or duplicated.');
      const tagPolicy = gh('GET', `${base}/rulesets/${tags[0].id}`).value;
      if (
        tagPolicy.enforcement !== 'active' ||
        tagPolicy.target !== 'tag' ||
        tagPolicy.bypass_actors?.length ||
        !tagPolicy.conditions?.ref_name?.include?.includes('refs/tags/v*') ||
        !['update', 'deletion'].every((type) => tagPolicy.rules?.some((rule) => rule.type === type))
      )
        throw new Error('Version-tag protection readback differs from required policy.');
      const repo = check();
      if (
        repo.security_and_analysis?.secret_scanning?.status !== 'enabled' ||
        repo.security_and_analysis?.secret_scanning_push_protection?.status !== 'enabled'
      )
        throw new Error('Secret scanning readback was not enabled.');
      const reporting = gh('GET', `${base}/private-vulnerability-reporting`).value;
      const code = gh('GET', `${base}/code-scanning/default-setup`).value;
      if (!reporting?.enabled || code?.state !== 'configured')
        throw new Error(
          'Reporting or CodeQL setup is not confirmed; inspect provider progress and rerun.',
        );
    }
    console.log(
      'Verified available applied settings. Public anonymous clone/release and real fork/PR acceptance still require a separate, authorized visibility change.',
    );
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  configure();
