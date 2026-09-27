import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  protectionPolicy,
  immutableTags,
  assertVisibility,
} from '../../scripts/configure-github.mjs';
import { requiredJobs } from '../../scripts/release-contract.mjs';
test('future public protection requires all release checks without an impossible second reviewer', () => {
  const result = protectionPolicy();
  assert.deepEqual(
    result.required_status_checks.checks.map((check) => check.context),
    Object.keys(requiredJobs).sort(),
  );
  assert.ok(result.required_status_checks.checks.every((check) => check.app_id === 15368));
  assert.equal(result.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(result.enforce_admins, true);
  assert.equal(result.allow_force_pushes, false);
  assert.equal(result.allow_deletions, false);
  assert.deepEqual(immutableTags.bypass_actors, []);
});
test('existing stronger review and check requirements survive applying the policy', () => {
  const result = protectionPolicy({
    required_status_checks: {
      contexts: ['independent-audit'],
      checks: [{ context: 'independent-audit', app_id: 12 }],
    },
    required_pull_request_reviews: {
      required_approving_review_count: 2,
      require_code_owner_reviews: true,
    },
  });
  assert.equal(result.required_pull_request_reviews.required_approving_review_count, 2);
  assert.equal(result.required_pull_request_reviews.require_code_owner_reviews, true);
  assert.deepEqual(
    result.required_status_checks.checks.find((c) => c.context === 'independent-audit'),
    { context: 'independent-audit', app_id: 12 },
  );
});
test('identity and visibility drift stop the configuration', () => {
  const repo = { full_name: 'owner/repo', private: true, default_branch: 'main' };
  assert.doesNotThrow(() => assertVisibility(repo, 'owner/repo', 'private'));
  assert.throws(() => assertVisibility(repo, 'owner/repo', 'public'));
  assert.throws(() => assertVisibility(repo, 'owner/other', 'private'));
});

test('existing review restrictions survive even without preexisting status checks', () => {
  const result = protectionPolicy({
    required_status_checks: null,
    required_pull_request_reviews: {
      required_approving_review_count: 2,
      dismissal_restrictions: { users: [{ login: 'maintainer' }], teams: [], apps: [] },
    },
  });
  assert.equal(result.required_pull_request_reviews.required_approving_review_count, 2);
  assert.deepEqual(result.required_pull_request_reviews.dismissal_restrictions.users, [
    'maintainer',
  ]);
});
