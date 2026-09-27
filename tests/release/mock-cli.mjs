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
const missing = () => {
  console.error('gh: Not Found (HTTP 404)');
  process.exit(1);
};
const releaseStep = 'Run npm run test:release';
const hostedStep = 'Verify static deployment and local connector boundary';
const jobNames = [
  'verify (ubuntu-latest)',
  'verify (macos-latest)',
  'verify (windows-latest)',
  'browser (chromium)',
  'browser (msedge)',
  'repository-hygiene',
];
const artifactNames = ['connectors-Linux-X64', 'connectors-macOS-ARM64', 'connectors-Windows-X64'];

function jobs() {
  return jobNames.map((name) => {
    const steps = name.startsWith('verify ')
      ? [
          'Run npm ci',
          'Run npm run typecheck',
          'Run npm test',
          'Run npm run build',
          'Package bundled runtime',
          'Install and verify the packaged runtime',
        ]
      : name.startsWith('browser ')
        ? ['Run npm ci', 'Run npm run test:e2e']
        : [
            'Run npm ci',
            releaseStep,
            'Run npm run format:check',
            'Run npm run notices:check',
            'Run npm run audit:dependencies',
            'Scan reachable history for secrets',
          ];
    if (name === 'browser (chromium)' && scenario !== 'missing-hosted') steps.push(hostedStep);
    return {
      name,
      run_id: 7,
      head_sha: revision,
      status: 'completed',
      conclusion: 'success',
      steps: steps.map((step) => ({
        name: step,
        status: 'completed',
        conclusion:
          (scenario === 'skipped-unit' && step === 'Run npm test') ||
          (scenario === 'skipped-hosted' && step === hostedStep) ||
          (scenario === 'skipped-release-tests' && step === releaseStep)
            ? 'skipped'
            : 'success',
      })),
    };
  });
}

if (basename(process.argv[1]) === 'git') {
  if (args.join(' ') === 'rev-parse HEAD') {
    console.log(revision);
    process.exit(0);
  }
  if (args.join(' ') === 'status --porcelain') {
    process.stdout.write(scenario === 'dirty' ? ' M changed.txt\n' : '');
    process.exit(0);
  }
} else if (args[0] === 'api') {
  const endpoint = args[1];
  if (endpoint === base)
    output({
      private: scenario !== 'public' && !(scenario === 'visibility-drift' && state.assets),
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
  if (endpoint.startsWith(`${base}/releases?`))
    output([
      state.release ? [state.release] : scenario === 'existing' ? [{ tag_name: 'v0.1.0' }] : [],
    ]);
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
  if (endpoint === `${base}/releases/9/assets?per_page=100`) output([state.assets]);
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
} else if (args[0] === 'release') {
  if (args[1] === 'create') {
    state.mutations.push('create');
    state.release = { id: 9, tag_name: 'v0.1.0', draft: true, target_commitish: revision };
    save();
    process.exit(scenario === 'uncertain-create' ? 1 : 0);
  }
  if (args[1] === 'upload') {
    state.mutations.push('upload');
    state.assets = args.slice(args.indexOf('--repo') + 2).map((file) => ({
      name: basename(file),
      state: 'uploaded',
      size: statSync(file).size,
      digest: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex'),
    }));
    if (scenario === 'partial-upload') state.assets.pop();
    if (scenario === 'bad-upload-digest') state.assets[0].digest = 'sha256:' + '0'.repeat(64);
    save();
    process.exit(0);
  }
  if (args[1] === 'edit') {
    state.mutations.push('publish');
    state.release.draft = false;
    state.published = true;
    save();
    process.exit(scenario === 'uncertain-publish' ? 1 : 0);
  }
}
console.error('Unexpected mock CLI operation. No real command was invoked.');
process.exit(2);
