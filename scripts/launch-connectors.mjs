import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [connector, ...args] = process.argv.slice(2);
if (!['git', 'atlassian'].includes(connector)) {
  process.stdout.write('Usage: bmad-connectors <git|atlassian> [connector arguments]\n');
  process.exitCode = connector === '--help' || !connector ? 0 : 1;
} else {
  // CMD forwards its complete argument list once. Node removes the selector and
  // forwards every remaining argument without a shell or a fixed argument limit.
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL(`./connectors/${connector}.mjs`, import.meta.url)), ...args],
    { stdio: 'inherit', shell: false, windowsHide: false },
  );
  child.on('error', () => {
    process.stderr.write('The connector could not be started.\n');
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
