import { serve } from '@hono/node-server';
import { createServer, type AddressInfo } from 'node:net';

type Application = { fetch: (request: Request) => Response | Promise<Response> };

/** Serve a disposable connector on a loopback port the operating system assigns
 * while binding. A fixed number inside the ephemeral range can already be taken:
 * on Linux the source port of an outgoing loopback connection blocks a listener
 * while that connection is open and for a minute after its client closes it.
 * A connector rejects requests whose Host does not name its own port, so the
 * application is created only once that port is known. */
export async function serveOnLoopback<App extends Application>(
  create: (port: number) => App | Promise<App>,
) {
  let app: App | undefined;
  const server = serve({
    fetch: (request) => app?.fetch(request) ?? new Response(null, { status: 503 }),
    hostname: '127.0.0.1',
    port: 0,
  });
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Open browser connections can hold server.close open after every assertion
      // passed. This disposable fixture owns its sockets and closes them at teardown.
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
  const { port } = await new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      resolve(server.address() as AddressInfo);
    });
  });
  try {
    app = await create(port);
  } catch (error) {
    await close();
    throw error;
  }
  return { port, close };
}

/** Find a loopback port for a separate process that must receive its port as an
 * argument. The operating system picks one that is free now; it is released
 * here and bound again by that process moments later. */
export async function freeLoopbackPort() {
  const server = createServer();
  const { port } = await new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address() as AddressInfo));
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
