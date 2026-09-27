import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const targets = [
  { artifact: 'connectors-Linux-X64', platform: 'linux', arch: 'x64' },
  { artifact: 'connectors-macOS-ARM64', platform: 'darwin', arch: 'arm64' },
  { artifact: 'connectors-Windows-X64', platform: 'win32', arch: 'x64' },
];
const expectedJobs = [
  'verify (ubuntu-latest)',
  'verify (macos-latest)',
  'verify (windows-latest)',
  'browser (chromium)',
  'browser (msedge)',
  'repository-hygiene',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function command(program, args, { binary = false, optional = false } = {}) {
  try {
    const result = await exec(program, args, {
      encoding: binary ? 'buffer' : 'utf8',
      maxBuffer: binary ? 256 * 1024 * 1024 : 8 * 1024 * 1024,
      timeout: 180000,
      windowsHide: true,
      env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
    });
    return result.stdout;
  } catch (error) {
    if (optional && /\(HTTP 404\)/.test(String(error.stderr))) return undefined;
    // CLI errors can contain authenticated request details. Do not echo them.
    throw new Error(
      `${program} failed (exit ${error.code ?? 'unknown'}). Check the current release stage.`,
    );
  }
}
async function api(endpoint, { optional = false, paginate = false } = {}) {
  const output = await command(
    'gh',
    ['api', endpoint, '--hostname', 'github.com', ...(paginate ? ['--paginate', '--slurp'] : [])],
    { optional },
  );
  return output === undefined ? undefined : JSON.parse(output);
}

async function verifyArchive(
  directory,
  target,
  { version, revision, nodeVersion, license, notices },
) {
  const name = `bmad-project-ui-connectors-${target.platform}-${target.arch}`;
  const archive = join(directory, name + '.tar.gz');
  const checksum = archive + '.sha256';
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [basename(archive), basename(checksum)].sort(),
    'Unexpected CI artifact files.',
  );
  const digest = await fileHash(archive);
  assert.equal(
    (await readFile(checksum, 'utf8')).trim(),
    `${digest}  ${basename(archive)}`,
    'Archive checksum mismatch.',
  );

  const runtimeName = target.platform === 'win32' ? 'node.exe' : 'node';
  const launcher = target.platform === 'win32' ? 'bmad-connectors.cmd' : 'bmad-connectors';
  const installer =
    target.platform === 'win32'
      ? 'install.cmd'
      : target.platform === 'darwin'
        ? 'install.command'
        : 'install.sh';
  const expectedFiles = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    `runtime/${runtimeName}`,
    'runtime/LICENSE',
    'connectors/git.mjs',
    'connectors/atlassian.mjs',
    'runtime-checksum.json',
    'launch-connectors.mjs',
    'install-connectors.mjs',
    launcher,
    installer,
    'README.txt',
  ];
  const entries = (await command('tar', ['-tzf', archive])).trim().split('\n');
  const allowed = new Set([
    `${name}/`,
    `${name}/runtime/`,
    `${name}/connectors/`,
    `${name}/manifest.json`,
    ...expectedFiles.map((file) => `${name}/${file}`),
  ]);
  assert.equal(new Set(entries).size, entries.length, 'Duplicate archive paths.');
  assert(
    entries.every((entry) => allowed.has(entry)),
    'Unexpected or unsafe archive paths.',
  );
  assert(
    expectedFiles.every((file) => entries.includes(`${name}/${file}`)),
    'Incomplete connector archive.',
  );
  // Read members to stdout instead of extracting executable packages to disk.
  const types = (await command('tar', ['-tvzf', archive])).trim().split('\n');
  assert(
    types.every((entry) => entry.startsWith('-') || entry.startsWith('d')),
    'Archive links and special files are not allowed.',
  );
  const member = (file) => command('tar', ['-xOzf', archive, `${name}/${file}`], { binary: true });
  const manifest = JSON.parse((await member('manifest.json')).toString('utf8'));
  assert.equal(manifest.schemaVersion, 1, 'Unknown package manifest schema.');
  assert.equal(manifest.version, version, 'Package version does not match the release.');
  assert.equal(manifest.revision, revision, 'Package revision does not match the verified commit.');
  assert.equal(
    manifest.nodeVersion,
    nodeVersion,
    'Package Node version does not match .node-version.',
  );
  assert.equal(manifest.platform, target.platform);
  assert.equal(manifest.arch, target.arch);
  assert(Array.isArray(manifest.files), 'Missing package file checksums.');
  assert.deepEqual(
    manifest.files.map((file) => file.path).sort(),
    [...expectedFiles].sort(),
    'Manifest file list mismatch.',
  );
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/, 'Invalid package file checksum.');
    const executable =
      target.platform !== 'win32' &&
      [launcher, installer, `runtime/${runtimeName}`].includes(file.path);
    assert.equal(file.mode, executable ? 0o755 : 0o644, 'Unexpected package file permissions.');
    assert.equal(
      sha256(await member(file.path)),
      file.sha256,
      `Package checksum failed: ${file.path}`,
    );
  }
  assert.equal(
    (await member('LICENSE')).toString('utf8'),
    license,
    'The complete MIT license must be included.',
  );
  assert.equal(
    (await member('THIRD_PARTY_NOTICES.md')).toString('utf8'),
    notices,
    'Third-party notices differ from the verified source.',
  );
  const runtimeLicense = (await member('runtime/LICENSE')).toString('utf8');
  assert.match(runtimeLicense, /Node\.js/, 'Missing Node.js runtime license.');
  assert.match(
    runtimeLicense,
    /Permission is hereby granted/,
    'Incomplete Node.js runtime license.',
  );
  const runtimeChecksum = JSON.parse((await member('runtime-checksum.json')).toString('utf8'));
  const runtimeArchive = `node-v${nodeVersion}-${target.platform === 'win32' ? 'win' : target.platform}-${target.arch}.${target.platform === 'win32' ? 'zip' : 'tar.gz'}`;
  assert.equal(runtimeChecksum.nodeVersion, nodeVersion);
  assert.equal(runtimeChecksum.archive, runtimeArchive);
  assert.equal(runtimeChecksum.source, `https://nodejs.org/dist/v${nodeVersion}/${runtimeArchive}`);
  assert.match(runtimeChecksum.sha256, /^[a-f0-9]{64}$/);
  return Promise.all(
    [archive, checksum].map(async (path) => ({
      path,
      name: basename(path),
      digest: 'sha256:' + (await fileHash(path)),
      size: (await stat(path)).size,
    })),
  );
}

async function main() {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || (args.length === 1 && args[0] === '--check'),
    'Usage: node scripts/create-release.mjs [--check]',
  );
  const checkOnly = args[0] === '--check';
  const repository = process.env.GITHUB_REPOSITORY;
  const revision = process.env.GITHUB_SHA;
  assert.match(
    repository ?? '',
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    'GITHUB_REPOSITORY is required.',
  );
  assert.match(revision ?? '', /^[a-f0-9]{40}$/, 'An exact GITHUB_SHA is required.');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Release only from main.');
  if (!checkOnly) {
    assert.equal(
      process.env.GITHUB_ACTIONS,
      'true',
      'Publish through the manual release workflow.',
    );
    assert.equal(
      process.env.GITHUB_EVENT_NAME,
      'workflow_dispatch',
      'Release requires workflow_dispatch.',
    );
  }
  assert.equal(
    (await command('git', ['rev-parse', 'HEAD'])).trim(),
    revision,
    'Checkout does not match GITHUB_SHA.',
  );
  assert.equal(
    (await command('git', ['status', '--porcelain'])).trim(),
    '',
    'Release checkout must be clean.',
  );
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/, 'Release requires a stable semantic version.');
  assert.equal(metadata.license, 'MIT', 'This release requires the MIT license.');
  const tag = `v${metadata.version}`;
  const license = await readFile('LICENSE', 'utf8');
  assert.match(license, /^MIT License\r?\n/);
  assert.match(license, /Permission is hereby granted/);
  const notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8');
  assert.match(notices, /Permission is hereby granted/, 'Third-party license texts are required.');
  const nodeVersion = (await readFile('.node-version', 'utf8')).trim();
  const base = `repos/${repository}`;
  const privateMain = async () => {
    const repo = await api(base);
    assert.equal(repo.private, true, 'This release must remain in a private GitHub repository.');
    assert.equal(
      repo.full_name.toLowerCase(),
      repository.toLowerCase(),
      'Repository identity mismatch.',
    );
    assert.equal(repo.default_branch, 'main', 'Expected main as the default branch.');
    assert.equal(
      (await api(`${base}/git/ref/heads/main`)).object.sha,
      revision,
      'main advanced; dispatch a new release after its CI passes.',
    );
    return repo;
  };
  const repo = await privateMain();
  const tagCommit = async () => {
    const ref = await api(`${base}/git/ref/tags/${tag}`, { optional: true });
    if (!ref) return undefined;
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++)
      object = (await api(`${base}/git/tags/${object.sha}`)).object;
    assert.equal(object.type, 'commit', 'The release tag must resolve to a commit.');
    assert.equal(object.sha, revision, 'Existing release tag points to another commit.');
    return object.sha;
  };
  const noExistingRelease = async () => {
    const pages = await api(`${base}/releases?per_page=100`, { paginate: true });
    assert(
      !pages.flat().some((release) => release.tag_name === tag),
      'This tag already has a release or draft. Inspect it before retrying; existing releases are never replaced.',
    );
  };
  await noExistingRelease();
  await tagCommit();

  console.log(`Checking completed CI for ${tag} at ${revision}.`);
  const runs = await api(
    `${base}/actions/workflows/ci.yml/runs?head_sha=${revision}&branch=main&event=push&per_page=100`,
  );
  const run = runs.workflow_runs.find(
    (candidate) =>
      candidate.head_sha === revision &&
      candidate.head_branch === 'main' &&
      candidate.event === 'push',
  );
  assert(run, 'No ci.yml push run exists for this exact main commit.');
  assert.equal(run.status, 'completed', 'Wait for exact-commit CI to finish, then dispatch again.');
  assert.equal(run.conclusion, 'success', 'Exact-commit CI did not pass.');
  assert.equal(run.repository.id, repo.id, 'CI repository mismatch.');
  assert.equal(run.head_repository.id, repo.id, 'CI source repository mismatch.');
  const jobPages = await api(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, {
    paginate: true,
  });
  const jobs = jobPages.flatMap((page) => page.jobs);
  assert.deepEqual(
    jobs.map((job) => job.name).sort(),
    [...expectedJobs].sort(),
    'All six required CI jobs must exist exactly once.',
  );
  for (const job of jobs) {
    assert.equal(job.run_id, run.id);
    assert.equal(job.head_sha, revision);
    assert.equal(job.status, 'completed', `${job.name} did not complete.`);
    assert.equal(job.conclusion, 'success', `${job.name} did not pass.`);
    const requiredSteps = job.name.startsWith('verify ')
      ? [
          'Run npm ci',
          'Run npm run typecheck',
          'Run npm test',
          'Run npm run build',
          'Package bundled runtime',
          'Install and verify the packaged runtime',
        ]
      : job.name.startsWith('browser ')
        ? [
            'Run npm ci',
            'Run npm run test:e2e',
            ...(job.name === 'browser (chromium)'
              ? ['Verify static deployment and local connector boundary']
              : []),
          ]
        : [
            'Run npm ci',
            'Run npm run test:release',
            'Run npm run format:check',
            'Run npm run notices:check',
            'Run npm run audit:dependencies',
            'Scan reachable history for secrets',
          ];
    for (const requiredStep of requiredSteps)
      assert(
        job.steps.some(
          (step) =>
            step.name === requiredStep &&
            step.status === 'completed' &&
            step.conclusion === 'success',
        ),
        `${job.name} skipped ${requiredStep}.`,
      );
  }
  const artifactPages = await api(`${base}/actions/runs/${run.id}/artifacts?per_page=100`, {
    paginate: true,
  });
  const artifacts = artifactPages.flatMap((page) => page.artifacts);
  for (const target of targets) {
    const matches = artifacts.filter((artifact) => artifact.name === target.artifact);
    assert.equal(matches.length, 1, `Expected one ${target.artifact} artifact.`);
    assert.equal(matches[0].expired, false, 'Required CI artifact expired.');
    assert.equal(matches[0].workflow_run?.head_sha, revision, 'Artifact commit mismatch.');
    assert.equal(matches[0].workflow_run?.id, run.id, 'Artifact workflow mismatch.');
  }

  const temp = await mkdtemp(join(tmpdir(), 'connector-release-'));
  let draftAttempted = false;
  let draftCreated = false;
  let publishAttempted = false;
  let published = false;
  try {
    const assets = [];
    for (const target of targets) {
      console.log(`Validating ${target.artifact}.`);
      const directory = join(temp, target.artifact);
      await mkdir(directory);
      await command('gh', [
        'run',
        'download',
        String(run.id),
        '--repo',
        repository,
        '--name',
        target.artifact,
        '--dir',
        directory,
      ]);
      assets.push(
        ...(await verifyArchive(directory, target, {
          version: metadata.version,
          revision,
          nodeVersion,
          license,
          notices,
        })),
      );
    }
    const changelog = await readFile('CHANGELOG.md', 'utf8');
    const heading = `## ${metadata.version}`;
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex((line) => line === heading);
    assert(start >= 0, 'CHANGELOG.md must contain a section for this version.');
    const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    const body = lines
      .slice(start + 1, next === -1 ? undefined : next)
      .join('\n')
      .trim();
    assert(body.length > 0, 'The release changelog is empty.');
    const ciUrl = `https://github.com/${repository}/actions/runs/${run.id}`;
    const notes = `${body}\n\n### Verification and distribution\n\n- Source commit: \`${revision}\`. [All six CI jobs passed](${ciUrl}).\n- Connector packages: Linux x64, macOS arm64 and Windows x64, with bundled Node ${nodeVersion}; Git is installed separately.\n- The MIT license, third-party notices and Node.js license are included in every archive. Verify the accompanying SHA-256 checksum before installing.\n- Packages are unsigned and not notarized. Checksums detect corruption; they do not establish publisher identity.\n- Jira and Confluence production remote writes remain blocked. Provider acceptance uses mocks; no live tenant verification is claimed.\n- This release inherits the repository's private access. Only authorized repository users can view or download GitHub release assets; publishing this release does not make the repository public.\n`;
    if (checkOnly) {
      console.log(
        `Read-only release validation passed: ${tag}, ${assets.length} assets, ${ciUrl}. No release was created.`,
      );
      return;
    }
    const notesPath = join(temp, 'release-notes.md');
    await writeFile(notesPath, notes);
    await privateMain();
    await noExistingRelease();
    await tagCommit();
    console.log(`Creating a private-repository draft for ${tag}.`);
    draftAttempted = true;
    await command('gh', [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      revision,
      '--draft',
      '--title',
      `${metadata.displayName || metadata.name} ${tag}`,
      '--notes-file',
      notesPath,
    ]);
    draftCreated = true;
    // The tag endpoint is for published releases; list drafts with the writer's token.
    const draft = (await api(`${base}/releases?per_page=100`, { paginate: true }))
      .flat()
      .find((release) => release.tag_name === tag);
    assert(draft, 'Draft creation could not be verified.');
    assert.equal(draft.draft, true, 'Expected an unpublished draft.');
    assert.equal(draft.target_commitish, revision, 'Draft target commit mismatch.');
    await command('gh', [
      'release',
      'upload',
      tag,
      '--repo',
      repository,
      ...assets.map((asset) => asset.path),
    ]);
    const verifyAssets = async () => {
      const uploaded = (
        await api(`${base}/releases/${draft.id}/assets?per_page=100`, { paginate: true })
      ).flat();
      assert.deepEqual(
        uploaded.map((asset) => asset.name).sort(),
        assets.map((asset) => asset.name).sort(),
        'Release assets are incomplete.',
      );
      for (const expected of assets) {
        const actual = uploaded.find((asset) => asset.name === expected.name);
        assert.equal(actual.state, 'uploaded', 'Release asset upload is incomplete.');
        assert.equal(actual.size, expected.size, 'Release asset size mismatch.');
        assert.equal(actual.digest, expected.digest, 'GitHub release asset checksum mismatch.');
      }
    };
    await verifyAssets();
    await privateMain();
    await tagCommit();
    console.log(`Publishing ${tag} after all six asset digests match.`);
    publishAttempted = true;
    await command('gh', [
      'release',
      'edit',
      tag,
      '--repo',
      repository,
      '--draft=false',
      '--latest',
    ]);
    published = true;
    const release = await api(`${base}/releases/tags/${tag}`);
    assert.equal(release.draft, false, 'Release publication is unconfirmed.');
    assert.equal(release.id, draft.id, 'Release identity changed.');
    assert.equal(await tagCommit(), revision, 'Published tag does not match the verified source.');
    await verifyAssets();
    await privateMain();
    console.log(
      `Verified release: https://github.com/${repository}/releases/tag/${tag}. Repository remains private.`,
    );
  } catch (error) {
    if (draftAttempted && !draftCreated)
      console.error(
        'Draft creation has an uncertain outcome. Inspect the release list before retrying; no release or tag was deleted.',
      );
    if (draftCreated && !publishAttempted)
      console.error(
        'Release failed after draft creation. The draft is preserved for inspection and no publish request was made. Do not delete or replace it blindly.',
      );
    if (publishAttempted && !published)
      console.error(
        'Publication has an uncertain outcome. Inspect the release before retrying; no release or tag was deleted.',
      );
    if (published)
      console.error(
        'The publish request completed, but final verification failed. Inspect the release before retrying; no release or tag was deleted.',
      );
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
