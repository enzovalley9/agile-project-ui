import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Installed only in each test's temporary PATH. No network APIs are imported.
const args = process.argv.slice(2);
const root = process.env.RELEASE_TEST_ROOT;
const scenario = process.env.RELEASE_TEST_SCENARIO;
const statePath = join(root, 'state.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const revision = 'a'.repeat(40);
const base = 'repos/test-owner/test-project';
const output = (value) => {
  console.log(JSON.stringify(value));
  process.exit(0);
};
const save = () => writeFileSync(statePath, JSON.stringify(state));
const releaseIdentity = () => ({
  id: 9,
  url: `https://api.github.com/${base}/releases/9`,
  tag_name: 'v0.1.0',
  draft: true,
  target_commitish: revision,
  name: 'synthetic-project v0.1.0',
  prerelease: false,
  body: 'Previously reviewed notes',
});
const assetFor = (file) => ({
  name: basename(file),
  state: 'uploaded',
  size: statSync(file).size,
  digest: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex'),
});
if (scenario.startsWith('resume-') && !state.release) {
  state.release = releaseIdentity();
  if (scenario === 'resume-wrong-id') state.release.id = 8;
  if (scenario === 'resume-wrong-repository')
    state.release.url = 'https://api.github.com/repos/other/project/releases/9';
  if (scenario === 'resume-wrong-tag') state.release.tag_name = 'v0.2.0';
  if (scenario === 'resume-published') state.release.draft = false;
  if (scenario === 'resume-wrong-target') state.release.target_commitish = 'b'.repeat(40);
  if (scenario === 'resume-wrong-title') state.release.name = 'Another project';
  if (scenario === 'resume-prerelease') state.release.prerelease = true;
  state.assets = [];
  if (
    [
      'resume-complete',
      'resume-partial',
      'resume-bad-digest',
      'resume-bad-size',
      'resume-unfinished',
      'resume-extra',
      'resume-check',
    ].includes(scenario)
  ) {
    state.assets = readdirSync(join(root, 'artifacts')).flatMap((directory) =>
      readdirSync(join(root, 'artifacts', directory)).map((file) =>
        assetFor(join(root, 'artifacts', directory, file)),
      ),
    );
    state.assets.push(
      ...readdirSync(join(root, 'sbom')).map((file) => assetFor(join(root, 'sbom', file))),
    );
    if (scenario === 'resume-partial') state.assets.pop();
    if (scenario === 'resume-bad-digest') state.assets[0].digest = 'sha256:' + '0'.repeat(64);
    if (scenario === 'resume-bad-size') state.assets[0].size++;
    if (scenario === 'resume-unfinished') state.assets[0].state = 'starter';
    if (scenario === 'resume-extra') state.assets.push({ name: 'unexpected.txt' });
  }
  save();
}
const missing = () => {
  console.error('gh: Not Found (HTTP 404)');
  process.exit(1);
};
const releaseStep = 'Run npm run test:release';
const hostedStep = 'Verify static deployment and local connector boundary';
const contract = JSON.parse(readFileSync(join(root, 'contract.json'), 'utf8'));
const artifactNames = contract.targets.map((target) => target.artifact);
const assetCount = artifactNames.length * 2 + 2;

function jobs() {
  const result = Object.entries(contract.jobs).map(([name, requiredSteps]) => {
    const steps = requiredSteps.filter(
      (step) => !(scenario === 'missing-hosted' && step === hostedStep),
    );
    return {
      name,
      run_id: 7,
      head_sha: revision,
      status: 'completed',
      conclusion: scenario === 'failed-docker' && name === 'docker' ? 'failure' : 'success',
      steps: steps.map((step) => ({
        name: step,
        status: 'completed',
        conclusion:
          (scenario === 'skipped-unit' && step === 'Run npm test') ||
          (scenario === 'skipped-hosted' && step === hostedStep) ||
          (scenario === 'skipped-release-tests' && step === releaseStep) ||
          (scenario === 'skipped-docker' && step === 'Run npm run test:docker')
            ? 'skipped'
            : 'success',
      })),
    };
  });
  if (scenario === 'unexpected-job') result.push({ ...result[0], name: 'unreviewed-job' });
  if (scenario === 'duplicate-job') result.push(result[0]);
  return result;
}

if (basename(process.argv[1]) === 'git') {
  if (args.join(' ') === 'rev-parse HEAD') {
    console.log(revision);
    process.exit(0);
  }
  if (args.join(' ') === 'show -s --format=%cI HEAD') {
    console.log('2026-09-27T00:00:00Z');
    process.exit(0);
  }
  if (args.join(' ') === 'status --porcelain') {
    process.stdout.write(scenario === 'dirty' ? ' M changed.txt\n' : '');
    process.exit(0);
  }
} else if (args[0] === 'attestation' && args[1] === 'verify') {
  const expected = [
    '--repo',
    'test-owner/test-project',
    '--signer-workflow',
    'test-owner/test-project/.github/workflows/release.yml',
    '--source-ref',
    'refs/heads/main',
    '--source-digest',
    revision,
    '--signer-digest',
    revision,
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ];
  if (JSON.stringify(args.slice(3)) !== JSON.stringify(expected)) process.exit(2);
  if (scenario === 'public-bad-attestation') process.exit(1);
  state.attestationChecks = (state.attestationChecks ?? 0) + 1;
  save();
  output([
    {
      verificationResult: {
        statement: { subject: [{ digest: { sha256: assetFor(args[2]).digest.slice(7) } }] },
      },
    },
  ]);
} else if (args[0] === 'api') {
  const endpoint = args[1];
  const method = args[args.indexOf('--method') + 1];
  const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : undefined;
  if (endpoint === base)
    output({
      private: !(scenario === 'public' || scenario.startsWith('public-'))
        ? !(scenario === 'visibility-drift' && state.assets)
        : Boolean(scenario === 'public-visibility-drift' && state.assets),
      full_name: 'test-owner/test-project',
      default_branch: 'main',
      id: 1,
    });
  if (endpoint === `${base}/git/ref/heads/main`) output({ object: { sha: revision } });
  if (endpoint === `${base}/git/ref/tags/v0.1.0`) {
    if (scenario === 'tag-drift') output({ object: { type: 'commit', sha: 'b'.repeat(40) } });
    if (scenario === 'tag-same' || state.published)
      output({ object: { type: 'commit', sha: revision } });
    missing();
  }
  if (endpoint === `${base}/releases` && method === 'POST') {
    state.mutations.push('create');
    state.release = { ...releaseIdentity(), ...JSON.parse(readFileSync(input, 'utf8')) };
    state.assets = [];
    save();
    if (scenario === 'uncertain-create') process.exit(1);
    output(state.release);
  }
  if (endpoint.startsWith(`${base}/releases?`)) {
    if (scenario === 'resume-conflicting') output([[{ ...state.release, id: 99 }]]);
    // Regression: GitHub App list responses can omit a draft that POST just created.
    state.releaseListReads = (state.releaseListReads ?? 0) + 1;
    save();
    output([
      scenario === 'created-hidden' || scenario.startsWith('resume-')
        ? []
        : state.release
          ? [state.release]
          : scenario === 'existing'
            ? [{ tag_name: 'v0.1.0' }]
            : [],
    ]);
  }
  if (endpoint === `${base}/releases/9`) {
    if (scenario === 'resume-drift-before-publish' && state.assets.length === assetCount)
      state.release.target_commitish = 'b'.repeat(40);
    if (scenario === 'resume-missing') missing();
    if (method === 'PATCH') {
      const patch = JSON.parse(readFileSync(input, 'utf8'));
      if (
        Object.keys(patch).some(
          (key) =>
            ![
              'draft',
              'body',
              'make_latest',
              'tag_name',
              'target_commitish',
              'name',
              'prerelease',
            ].includes(key),
        )
      )
        process.exit(2);
      for (const key of ['tag_name', 'target_commitish', 'name', 'prerelease'])
        if (key in patch && patch[key] !== state.release[key]) process.exit(2);
      // Observed GitHub behavior: an omitted draft tag can become an untagged alias.
      if (scenario === 'resume-preserve-identity')
        state.release.tag_name = patch.tag_name ?? 'untagged-synthetic-regression';
      state.mutations.push('publish');
      state.release = { ...state.release, ...patch };
      state.published = true;
      save();
      if (scenario === 'uncertain-publish') process.exit(1);
    }
    if (!state.release) missing();
    output(state.release);
  }
  if (
    endpoint.startsWith(`https://uploads.github.com/${base}/releases/9/assets?name=`) &&
    method === 'POST'
  ) {
    if (!state.mutations.includes('upload')) state.mutations.push('upload');
    state.uploads = (state.uploads ?? 0) + 1;
    const asset = assetFor(input);
    if (
      new URL(endpoint).searchParams.get('name') !== asset.name ||
      state.assets.some((item) => item.name === asset.name)
    )
      process.exit(2);
    if (scenario === 'bad-upload-digest') asset.digest = 'sha256:' + '0'.repeat(64);
    if (!(scenario === 'partial-upload' && state.uploads === assetCount)) state.assets.push(asset);
    save();
    output(asset);
  }
  if (endpoint.startsWith(`${base}/actions/workflows/ci.yml/runs?`))
    output({
      workflow_runs: [
        {
          id: 7,
          head_sha: revision,
          head_branch: 'main',
          event: 'push',
          status: 'completed',
          conclusion: scenario === 'ci-failed' ? 'failure' : 'success',
          repository: { id: 1 },
          head_repository: { id: 1 },
        },
      ],
    });
  if (endpoint.startsWith(`${base}/actions/runs/7/jobs?`))
    output([{ jobs: scenario === 'missing-job' ? jobs().slice(0, -1) : jobs() }]);
  if (endpoint.startsWith(`${base}/actions/runs/7/artifacts?`))
    output([
      {
        artifacts: artifactNames.map((name) => ({
          name,
          expired: scenario === 'expired',
          workflow_run: { head_sha: revision, id: 7 },
        })),
      },
    ]);
  if (endpoint === `${base}/releases/9/assets?per_page=100`) {
    state.assetReads = (state.assetReads ?? 0) + 1;
    if (scenario === 'resume-assets-race' && state.assetReads === 2)
      state.assets.push({ name: 'concurrent-upload.txt' });
    save();
    output([state.assets ?? []]);
  }
  if (endpoint === `${base}/releases/tags/v0.1.0`) {
    if (state.published) output(state.release);
    missing();
  }
} else if (args[0] === 'run' && args[1] === 'download') {
  const artifact = args[args.indexOf('--name') + 1];
  const destination = args[args.indexOf('--dir') + 1];
  for (const file of readdirSync(join(root, 'artifacts', artifact)))
    copyFileSync(join(root, 'artifacts', artifact, file), join(destination, file));
  process.exit(0);
}
console.error('Unexpected mock CLI operation. No real command was invoked.');
process.exit(2);
