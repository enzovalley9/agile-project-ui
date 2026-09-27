// Probe only container loopback. Never read capabilities, contact a provider or mutate data.
const probes = [
  [8080, '/healthz'],
  [43120, '/v1/health'],
  [43121, '/v1/health'],
  [43122, '/v1/health'],
];
const results = await Promise.all(
  probes.map(async ([port, route]) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }),
);
process.exitCode = results.some(Boolean) ? 0 : 1;
