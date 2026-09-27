import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { GitError, requireCondition, safeError } from './errors';
import { GitService } from './service';
import type { GitOptions, MutationContext } from './types';

export function createGitApp(options: GitOptions): Hono & { service: GitService } {
  const service = new GitService(options);
  // Route errors own initialization failures; avoid a detached rejected promise.
  void service.ready.catch(() => undefined);
  const app = new Hono() as Hono & { service: GitService };
  app.service = service;
  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'REQUEST_TOO_LARGE', message: 'The request exceeds 64 KiB.' } },
          413,
        ),
    }),
  );
  const validToken = (header: string | undefined) => {
    const provided = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
    const expected = Buffer.from(options.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  };
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    requireCondition(
      [
        `127.0.0.1:${options.port ?? 43120}`,
        `localhost:${options.port ?? 43120}`,
        `[::1]:${options.port ?? 43120}`,
      ].includes(host),
      'HOST_DENIED',
      'The connector accepts loopback requests only.',
      403,
    );
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.path === '/v1/health' && c.req.method === 'GET') {
      if (c.req.header('origin') === options.origin) {
        c.header('Access-Control-Allow-Origin', options.origin);
        c.header('Vary', 'Origin');
      }
      await next();
      return;
    }
    requireCondition(
      c.req.header('origin') === options.origin,
      'ORIGIN_DENIED',
      'This web origin is not authorized for the connector.',
      403,
    );
    c.header('Access-Control-Allow-Origin', options.origin);
    c.header('Vary', 'Origin');
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-BMAD-Binding');
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }
    requireCondition(
      validToken(c.req.header('authorization')),
      'AUTH_REQUIRED',
      'The local Git capability is missing or invalid.',
      401,
    );
    if (c.req.method === 'POST') {
      requireCondition(
        c.req.header('content-type')?.split(';')[0].trim() === 'application/json',
        'JSON_REQUIRED',
        'Send a JSON request.',
        415,
      );
      const length = c.req.header('content-length');
      requireCondition(
        !length || Number(length) <= 64 * 1024,
        'REQUEST_TOO_LARGE',
        'The request is too large.',
        413,
      );
      const text = await c.req.text();
      requireCondition(
        Buffer.byteLength(text) <= 64 * 1024,
        'REQUEST_TOO_LARGE',
        'The request is too large.',
        413,
      );
      try {
        const body: unknown = JSON.parse(text);
        requireCondition(
          body && typeof body === 'object' && !Array.isArray(body),
          'INVALID_JSON',
          'Expected a JSON object.',
          400,
        );
      } catch (error) {
        if (error instanceof GitError) throw error;
        throw new GitError('INVALID_JSON', 'Expected valid JSON.', 400);
      }
    }
    await next();
  });
  app.get('/v1/health', (c) =>
    c.json({ product: 'BMAD Project UI Git Connector', protocol: 1, version: '0.1.0' }),
  );
  app.post('/v1/session', async (c) => {
    const body = await c.req.json<{ trustRepository: boolean }>();
    requireCondition(
      typeof body.trustRepository === 'boolean',
      'TRUST_REQUIRED',
      'Explicitly choose repository trust.',
      400,
    );
    await service.ready;
    return c.json(service.session(body.trustRepository));
  });
  app.delete('/v1/session', (c) => {
    service.disconnect();
    return c.json({ disconnected: true });
  });
  app.post('/v1/bindings/challenge', async (c) => c.json(await service.challenge()));
  app.post('/v1/bindings/verify', async (c) => {
    const body = await c.req.json<{ id: string }>();
    requireCondition(typeof body.id === 'string', 'INVALID_ID', 'A challenge ID is required.', 400);
    return c.json(await service.verifyBinding(body.id));
  });
  app.use('/v1/repository', async (c, next) => {
    service.assertBinding(c.req.header('x-bmad-binding'));
    await next();
  });
  app.use('/v1/branches', async (c, next) => {
    service.assertBinding(c.req.header('x-bmad-binding'));
    await next();
  });
  app.use('/v1/plans/*', async (c, next) => {
    service.assertBinding(c.req.header('x-bmad-binding'));
    await next();
  });
  app.use('/v1/operations', async (c, next) => {
    service.assertBinding(c.req.header('x-bmad-binding'));
    await next();
  });
  app.use('/v1/operations/*', async (c, next) => {
    service.assertBinding(c.req.header('x-bmad-binding'));
    await next();
  });
  app.get('/v1/repository', async (c) => c.json(await service.repository()));
  app.get('/v1/branches', async (c) => c.json(await service.branches()));
  app.post('/v1/plans/commit', async (c) => c.json(await service.planCommit(await c.req.json())));
  app.post('/v1/plans/branch', async (c) => c.json(await service.planBranch(await c.req.json())));
  app.post('/v1/plans/push', async (c) => c.json(await service.planPush(await c.req.json())));
  app.get('/v1/operations', async (c) => c.json(await service.operations()));
  app.post('/v1/operations', async (c) => {
    const body = await c.req.json<MutationContext & { planId: string }>();
    requireCondition(
      typeof body.planId === 'string',
      'INVALID_ID',
      'A reviewed plan ID is required.',
      400,
    );
    return c.json(await service.execute(body.planId, body));
  });
  app.get('/v1/operations/by-plan/:planId', async (c) =>
    c.json(await service.operationByPlan(c.req.param('planId'))),
  );
  app.get('/v1/operations/:id', async (c) => c.json(await service.operation(c.req.param('id'))));
  app.post('/v1/operations/:id/reconcile', async (c) =>
    c.json(await service.reconcile(c.req.param('id'))),
  );
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'This connector exposes Git operations and connection lifecycle only.',
        },
      },
      404,
    ),
  );
  app.onError((error, c) =>
    c.json({ error: safeError(error) }, (error instanceof GitError ? error.status : 500) as 400),
  );
  return app;
}
export { GitService } from './service';
export type * from './types';
