import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const releaseScript = fileURLToPath(new URL('../../scripts/create-release.mjs', import.meta.url));
const mockCli = await readFile(new URL('./mock-cli.mjs', import.meta.url), 'utf8');
const revision = 'a'.repeat(40);
const nodeVersion = '24.21.0';
const license = 'MIT License\n\nPermission is hereby granted to this synthetic test fixture.\n';
const notices = 'Synthetic notices. Permission is hereby granted for test data.\n';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const targets = [
  ['connectors-Linux-X64', 'linux', 'x64'],
  ['connectors-macOS-ARM64', 'darwin', 'arm64'],
  ['connectors-Windows-X64', 'win32', 'x64'],
];

async function createArchive(root, [artifact, platform, arch], scenario) {
  const name = `bmad-project-ui-connectors-${platform}-${arch}`;
  const directory = join(root, name);
  const destination = join(root, 'artifacts', artifact);
  for (const folder of [
    directory,
    join(directory, 'runtime'),
    join(directory, 'connectors'),
    destination,
  ])
    await mkdir(folder, { recursive: true });
  const runtime = platform === 'win32' ? 'node.exe' : 'node';
  const launcher = platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors';
  const installer =
    platform === 'win32' ? 'install.cmd' : platform === 'darwin' ? 'install.command' : 'install.sh';
  const runtimeArchive = `node-v${nodeVersion}-${platform === 'win32' ? 'win' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const contents = {
    LICENSE: license,
    'THIRD_PARTY_NOTICES.md': notices,
    [`runtime/${runtime}`]: 'Synthetic runtime; never executed.',
    'runtime/LICENSE': 'Node.js: Permission is hereby granted for this synthetic fixture.',
    'connectors/git.mjs': '// Synthetic connector, never executed.',
    'connectors/atlassian.mjs': '// Synthetic connector, never executed.',
    'runtime-checksum.json': JSON.stringify({
      nodeVersion,
      archive: runtimeArchive,
      source: `https://nodejs.org/dist/v${nodeVersion}/${runtimeArchive}`,
      sha256: 'f'.repeat(64),
    }),
    'launch-connectors.mjs': '// Synthetic launcher, never executed.',
    'install-connectors.mjs': '// Synthetic installer, never executed.',
    [launcher]: 'Synthetic wrapper, never executed.',
    [installer]: 'Synthetic installer wrapper, never executed.',
    'README.txt': 'Synthetic package for release gate tests.',
  };
  const files = [];
  for (const [path, content] of Object.entries(contents)) {
    const mode =
      platform !== 'win32' && [launcher, installer, `runtime/${runtime}`].includes(path)
        ? 0o755
        : 0o644;
    await writeFile(join(directory, path), content);
    await chmod(join(directory, path), mode);
    files.push({ path, sha256: hash(content), mode });
  }
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      version: '0.1.0',
      revision: scenario === 'manifest-drift' ? 'b'.repeat(40) : revision,
      nodeVersion,
      platform,
      arch,
      files,
    }),
  );
  if (scenario === 'member-tamper')
    await writeFile(join(directory, 'connectors/git.mjs'), 'Tampered content.');
  if (scenario === 'missing-license') await unlink(join(directory, 'LICENSE'));
  const archive = join(destination, `${name}.tar.gz`);
  await exec('tar', ['-czf', archive, '-C', root, name], { timeout: 10000 });
  const digest = scenario === 'archive-tamper' ? '0'.repeat(64) : hash(await readFile(archive));
  await writeFile(archive + '.sha256', `${digest}  ${name}.tar.gz\n`);
}

async function runScenario(scenario) {
  const root = await mkdtemp(join(tmpdir(), 'release-gate-test-'));
  try {
    const bin = join(root, 'bin');
    const checkout = join(root, 'checkout');
    await mkdir(bin);
    await mkdir(checkout);
    await writeFile(join(bin, 'package.json'), '{"type":"module"}\n');
    for (const program of ['gh', 'git'])
      await writeFile(join(bin, program), '#!/usr/bin/env node\n' + mockCli, { mode: 0o755 });
    for (const [file, value] of Object.entries({
      'package.json': JSON.stringify({
        name: 'synthetic-project',
        version: '0.1.0',
        license: 'MIT',
      }),
      '.node-version': nodeVersion + '\n',
      LICENSE: license,
      'THIRD_PARTY_NOTICES.md': notices,
      'CHANGELOG.md': '# Changelog\n\n## 0.1.0\n\nSynthetic release test.\n',
    }))
      await writeFile(join(checkout, file), value);
    await writeFile(join(root, 'state.json'), JSON.stringify({ mutations: [] }));
    for (const target of targets) await createArchive(root, target, scenario);
    let result;
    try {
      result = {
        ...(await exec(
          process.execPath,
          [releaseScript, ...(scenario === 'check' ? ['--check'] : [])],
          {
            cwd: checkout,
            // Deliberately omit inherited credentials. Every gh/git call resolves to the shim.
            env: {
              PATH: [bin, dirname(process.execPath), process.env.PATH]
                .filter(Boolean)
                .join(delimiter),
              RELEASE_TEST_ROOT: root,
              RELEASE_TEST_SCENARIO: scenario,
              GITHUB_REPOSITORY: 'test-owner/test-project',
              GITHUB_SHA: revision,
              GITHUB_REF: 'refs/heads/main',
              GITHUB_ACTIONS: 'true',
              GITHUB_EVENT_NAME: 'workflow_dispatch',
            },
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          },
        )),
        code: 0,
      };
    } catch (error) {
      result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
    return { ...result, state: JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const cases = [
  ['check', 'validates all packages without creating a release', [], null],
  [
    'success',
    'publishes only after all six uploads are verified',
    ['create', 'upload', 'publish'],
    null,
  ],
  [
    'tag-same',
    'permits an existing tag only at the exact commit',
    ['create', 'upload', 'publish'],
    null,
  ],
  ['public', 'rejects a public repository', [], 'must remain in a private GitHub repository'],
  ['dirty', 'rejects a dirty checkout', [], 'Release checkout must be clean'],
  ['ci-failed', 'rejects a failed exact-commit CI run', [], 'Exact-commit CI did not pass'],
  [
    'skipped-unit',
    'rejects skipped unit tests in an otherwise successful job',
    [],
    'skipped Run npm test',
  ],
  [
    'skipped-hosted',
    'rejects the skipped Chromium hosted boundary check',
    [],
    'skipped Verify static deployment and local connector boundary',
  ],
  [
    'missing-hosted',
    'rejects the missing Chromium hosted boundary check',
    [],
    'skipped Verify static deployment and local connector boundary',
  ],
  [
    'skipped-release-tests',
    'rejects skipped release gate regression tests',
    [],
    'skipped Run npm run test:release',
  ],
  ['missing-job', 'requires every one of the six CI jobs', [], 'All six required CI jobs'],
  ['existing', 'preserves an existing release or draft', [], 'already has a release or draft'],
  [
    'tag-drift',
    'preserves a tag pointing to a different commit',
    [],
    'Existing release tag points to another commit',
  ],
  ['expired', 'rejects expired CI artifacts', [], 'Required CI artifact expired'],
  ['archive-tamper', 'rejects an incorrect archive checksum', [], 'Archive checksum mismatch'],
  [
    'manifest-drift',
    'rejects a manifest for another commit',
    [],
    'Package revision does not match',
  ],
  [
    'member-tamper',
    'rejects a modified archive member',
    [],
    'Package checksum failed: connectors/git.mjs',
  ],
  [
    'missing-license',
    'rejects a package missing its MIT license',
    [],
    'Incomplete connector archive',
  ],
  [
    'partial-upload',
    'keeps a partial upload as an unpublished draft',
    ['create', 'upload'],
    'Release assets are incomplete',
  ],
  [
    'bad-upload-digest',
    'keeps a wrong uploaded digest as an unpublished draft',
    ['create', 'upload'],
    'GitHub release asset checksum mismatch',
  ],
  [
    'visibility-drift',
    'stops publication if repository visibility changes',
    ['create', 'upload'],
    'must remain in a private GitHub repository',
  ],
  [
    'uncertain-create',
    'reports uncertain draft creation without deleting it',
    ['create'],
    'Draft creation has an uncertain outcome',
  ],
  [
    'uncertain-publish',
    'reports uncertain publication without deleting it',
    ['create', 'upload', 'publish'],
    'Publication has an uncertain outcome',
  ],
];

describe(
  'private release workflow gates',
  {
    // The release workflow runs on Ubuntu; PATH shims also support local macOS verification.
    skip:
      process.platform === 'win32'
        ? 'The release workflow and executable PATH shims use POSIX.'
        : false,
  },
  () => {
    for (const [scenario, description, mutations, error] of cases) {
      it(description, async () => {
        const result = await runScenario(scenario);
        assert.equal(result.code, error ? 1 : 0, result.stdout + result.stderr);
        assert.deepEqual(result.state.mutations, mutations);
        if (error) assert(result.stderr.includes(error), result.stderr);
        else
          assert(
            result.stdout.includes(
              scenario === 'check' ? 'Read-only release validation passed' : 'Verified release:',
            ),
            result.stdout,
          );
        assert.equal(Boolean(result.state.published), mutations.includes('publish'));
        if (mutations.includes('create') && !mutations.includes('publish'))
          assert.equal(result.state.release.draft, true);
      });
    }
  },
);
