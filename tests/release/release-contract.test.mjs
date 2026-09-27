import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { parse } from 'yaml';
import { nativeTargets, requiredJobs } from '../../scripts/release-contract.mjs';
import { sourceSbom } from '../../scripts/release-sbom.mjs';

const ci = parse(
  await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
);
const release = parse(
  await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'),
);

it('matches the release contract to every job and required step in the real CI workflow', () => {
  assert.deepEqual(
    Object.keys(ci.jobs).sort(),
    ['verify', 'browser', 'repository-hygiene', 'docker'].sort(),
  );
  assert.equal(ci.jobs.verify.name, 'verify (${{ matrix.os }})');
  assert.deepEqual(ci.jobs.verify.strategy.matrix, {
    include: nativeTargets.map(({ runner, platform, arch }) => ({ os: runner, platform, arch })),
  });
  assert.deepEqual(ci.jobs.browser.strategy.matrix, { channel: ['chromium', 'msedge'] });
  const actual = {
    ...Object.fromEntries(
      nativeTargets.map(({ runner }) => [`verify (${runner})`, ci.jobs.verify]),
    ),
    ...Object.fromEntries(
      ci.jobs.browser.strategy.matrix.channel.map((channel) => [
        `browser (${channel})`,
        ci.jobs.browser,
      ]),
    ),
    'repository-hygiene': ci.jobs['repository-hygiene'],
    docker: ci.jobs.docker,
  };
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(requiredJobs).sort());
  for (const [name, job] of Object.entries(actual)) {
    assert.equal(job['continue-on-error'], undefined, `${name} must fail CI on failure.`);
    for (const required of requiredJobs[name]) {
      const steps = job.steps.filter((step) => (step.name ?? `Run ${step.run}`) === required);
      assert.equal(steps.length, 1, `${name}: ${required} must exist once in the real workflow.`);
      assert.equal(
        steps[0]['continue-on-error'],
        undefined,
        `${required} must fail CI on failure.`,
      );
      const condition = [
        'Verify static deployment and local connector boundary',
        'Verify read-only beta across browsers',
      ].includes(required)
        ? "matrix.channel == 'chromium'"
        : undefined;
      assert.equal(steps[0].if, condition, `${required} has an unreviewed skip condition.`);
    }
  }
  const upload = ci.jobs.verify.steps.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  assert.equal(upload.with.name, 'connectors-${{ runner.os }}-${{ runner.arch }}');
  assert.equal(upload.with.path, 'dist/artifacts/*');
  assert.equal(
    ci.jobs.verify.steps.find((step) => step.name === 'Verify native platform').env
      .EXPECTED_PLATFORM,
    '${{ matrix.platform }}/${{ matrix.arch }}',
  );
});

it('requires deliberate release visibility and transports it as data instead of shell interpolation', () => {
  const policy = release.on.workflow_dispatch.inputs.expected_visibility;
  assert.deepEqual(policy.options, ['private', 'public']);
  assert.equal(policy.default, 'private');
  assert.equal(policy.required, true);
  const publish = release.jobs.release.steps.find(
    (step) => step.name === 'Validate CI artifacts and publish the verified release',
  );
  assert.equal(publish.env.EXPECTED_VISIBILITY, '${{ inputs.expected_visibility }}');
  assert.match(publish.run, /--expected-visibility "\$EXPECTED_VISIBILITY"/);
  assert(!publish.run.includes('${{'));
  assert.equal(release.jobs.release.if, "github.ref == 'refs/heads/main'");
});

it('gates public publication on a pinned attestation action before the final release validation', () => {
  const steps = release.jobs.release.steps;
  const prepare = steps.findIndex(
    (step) => step.name === 'Prepare exact verified public release assets',
  );
  const attest = steps.findIndex((step) => step.name === 'Attest verified public release assets');
  const publish = steps.findIndex(
    (step) => step.name === 'Validate CI artifacts and publish the verified release',
  );
  assert(prepare >= 0 && attest > prepare && publish > attest);
  for (const index of [prepare, attest]) {
    assert.equal(steps[index].if, "inputs.expected_visibility == 'public'");
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.match(steps[attest].uses, /^actions\/attest@[a-f0-9]{40}$/);
  assert.equal(steps[attest].with['subject-path'], '${{ runner.temp }}/release-assets/*');
  assert.match(steps[prepare].run, /--check --export-verified-assets/);
  assert.equal(release.jobs.release.permissions['id-token'], 'write');
  assert.equal(release.jobs.release.permissions.attestations, 'write');
});

it('produces deterministic source SPDX inventory and rejects unreviewed dependency locations', () => {
  const metadata = { name: 'test-project', version: '0.2.0', license: 'MIT' };
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': metadata,
      'node_modules/@example/dependency': {
        version: '1.0.0',
        license: 'MIT',
        resolved: 'https://registry.npmjs.org/@example/dependency/-/dependency-1.0.0.tgz',
        integrity: 'sha512-' + Buffer.alloc(64, 3).toString('base64'),
        dev: true,
      },
    },
  };
  const input = {
    lockfile: JSON.stringify(lock),
    metadata,
    revision: 'a'.repeat(40),
    repository: 'owner/project',
    nodeVersion: '24.21.0',
    created: '2026-09-27T00:00:00Z',
  };
  const output = sourceSbom(input);
  assert.equal(sourceSbom(input), output);
  const parsed = JSON.parse(output);
  assert.equal(parsed.spdxVersion, 'SPDX-2.3');
  assert.equal(parsed.packages.length, 3);
  assert.equal(
    parsed.packages[2].externalRefs[0].referenceLocator,
    'pkg:npm/%40example/dependency@1.0.0',
  );
  assert.equal(parsed.packages[2].checksums[0].checksumValue, '03'.repeat(64));
  assert.match(parsed.packages[0].sourceInfo, /package-lock.json SHA-256 [a-f0-9]{64}/);
  lock.packages['node_modules/@example/dependency'].resolved =
    'https://private.example/internal.tgz';
  assert.throws(
    () => sourceSbom({ ...input, lockfile: JSON.stringify(lock) }),
    /Review non-registry/,
  );
  assert.throws(
    () => sourceSbom({ ...input, metadata: { ...metadata, version: '0.3.0' } }),
    /version differs/,
  );
});
