// Changes to the release contract must also pass the actual workflow regression.
// Keep this dependency-free: release validation does not install or execute dependencies.
export const nativeTargets = [
  { runner: 'ubuntu-latest', artifact: 'connectors-Linux-X64', platform: 'linux', arch: 'x64' },
  {
    runner: 'ubuntu-24.04-arm',
    artifact: 'connectors-Linux-ARM64',
    platform: 'linux',
    arch: 'arm64',
  },
  { runner: 'macos-latest', artifact: 'connectors-macOS-ARM64', platform: 'darwin', arch: 'arm64' },
  { runner: 'macos-15-intel', artifact: 'connectors-macOS-X64', platform: 'darwin', arch: 'x64' },
  { runner: 'windows-latest', artifact: 'connectors-Windows-X64', platform: 'win32', arch: 'x64' },
  {
    runner: 'windows-11-arm',
    artifact: 'connectors-Windows-ARM64',
    platform: 'win32',
    arch: 'arm64',
  },
];

const nativeSteps = [
  'Verify native platform',
  'Run npm ci',
  'Run npm run typecheck',
  'Run npm test',
  'Run npm run build',
  'Package bundled runtime',
  'Install and verify the packaged runtime',
];

export const requiredJobs = {
  ...Object.fromEntries(nativeTargets.map(({ runner }) => [`verify (${runner})`, nativeSteps])),
  'browser (chromium)': [
    'Run npm ci',
    'Run npm run test:e2e',
    'Verify static deployment and local connector boundary',
    'Verify read-only beta across browsers',
  ],
  'browser (msedge)': ['Run npm ci', 'Run npm run test:e2e'],
  'repository-hygiene': [
    'Run npm ci',
    'Run npm run test:release',
    'Run npm run test:maintenance',
    'Run npm run test:security',
    'Run npm run test:docker:runtime',
    'Run npm run format:check',
    'Run npm run notices:check',
    'Run npm run audit:dependencies',
    'Scan reachable history for secrets',
  ],
  docker: ['Run npm ci', 'Build container for acceptance', 'Run npm run test:docker'],
};
