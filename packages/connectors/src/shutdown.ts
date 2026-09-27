/** Own one graceful drain even when a console signal and parent IPC overlap. */
export function registerConnectorShutdown(server: {
  close(): unknown;
  once(event: 'close', listener: () => void): unknown;
  closeAllConnections?: () => void;
}) {
  let draining = false;
  const shutdown = () => {
    if (draining) return;
    draining = true;
    server.close();
    setTimeout(() => server.closeAllConnections?.(), 10_000).unref();
  };
  const message = (value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'agile-project-ui:shutdown'
    )
      shutdown();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.connected) {
    process.on('message', message);
    process.once('disconnect', shutdown);
  }
  server.once('close', () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('message', message);
    process.removeListener('disconnect', shutdown);
    if (process.connected) process.disconnect?.();
  });
  if (process.connected) process.send?.({ type: 'agile-project-ui:ready' }, () => {});
  else if (typeof process.send === 'function') shutdown();
}
