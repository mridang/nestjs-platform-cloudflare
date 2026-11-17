import 'urlpattern-polyfill';
import { describe, it, expect } from '@jest/globals';
import { RequestMethod, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { CloudflareAdapter } from '../../src/index.js';
import type {
  CloudflareRequest,
  CloudflareResponse,
  ExpressCompatRequest,
  ExpressCompatResponse,
  ExpressNextFunction,
} from '../../src/index.js';

function registerMutableFieldsAndErrors(): void {
  describe('mutable per-request fields (no frozen sentinel)', () => {
    it('allows middleware to write to req.query when there is no query string', async () => {
      const adapter = new CloudflareAdapter();
      let threw = false;
      adapter.use(
        (
          req: CloudflareRequest,
          _res: CloudflareResponse,
          next: ExpressNextFunction,
        ) => {
          try {
            (req.query as Record<string, unknown>).page = '1';
          } catch {
            threw = true;
          }
          next();
        },
      );
      adapter.get('/m', (req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { page: req.query.page }),
      );

      const res = await adapter.handle(new Request('https://example.com/m'));
      expect(threw).toBe(false);
      expect(await res.json()).toEqual({ page: '1' });
    });

    it('allows handlers to write to req.params on a non-parametric route', async () => {
      const adapter = new CloudflareAdapter();
      let threw = false;
      adapter.get('/p', (req: CloudflareRequest, res: CloudflareResponse) => {
        try {
          req.params.tenant = 'acme';
        } catch {
          threw = true;
        }
        adapter.reply(res, { tenant: req.params.tenant });
      });

      const res = await adapter.handle(new Request('https://example.com/p'));
      expect(threw).toBe(false);
      expect(await res.json()).toEqual({ tenant: 'acme' });
    });

    it('allows writing to req.files and req.cookies when empty', async () => {
      const adapter = new CloudflareAdapter();
      let threw = false;
      adapter.get('/fc', (req: CloudflareRequest, res: CloudflareResponse) => {
        try {
          req.cookies.sid = 'x';
          (req.files as Record<string, unknown>).f = new File([''], 'a.txt');
        } catch {
          threw = true;
        }
        adapter.reply(res, { ok: true });
      });

      await adapter.handle(new Request('https://example.com/fc'));
      expect(threw).toBe(false);
    });
  });

  describe('Express error-handling middleware (next(err) -> 4-arg handler)', () => {
    it('routes next(err) from a normal middleware to a registered 4-arg error handler', async () => {
      const adapter = new CloudflareAdapter();
      // A normal 3-arg middleware that raises an error.
      adapter.useExpressMiddleware(
        (
          _req: ExpressCompatRequest,
          _res: ExpressCompatResponse,
          next: ExpressNextFunction,
        ) => {
          next(new Error('boom'));
        },
      );
      // A standalone 4-arg Express error handler that catches it and responds.
      // Express identifies error handlers by arity (4 params), so all four
      // must be declared even though `next` is unused here.
      adapter.useExpressMiddleware(
        (
          failure: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          expect(next).toBeInstanceOf(Function);
          res.status(500).json({
            caught: failure instanceof Error ? failure.message : 'not an error',
          });
        },
      );
      adapter.get('/x', (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(new Request('https://example.com/x'));
      expect(res.status).toBe(500);
      // Must be the custom error handler's body, NOT the generic 500 string.
      expect(await res.json()).toEqual({ caught: 'boom' });
    });

    it('falls through to the generic 500 when no error handler is registered', async () => {
      const adapter = new CloudflareAdapter();
      adapter.useExpressMiddleware(
        (
          _req: ExpressCompatRequest,
          _res: ExpressCompatResponse,
          next: ExpressNextFunction,
        ) => {
          next(new Error('unhandled'));
        },
      );
      adapter.get('/y', (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(new Request('https://example.com/y'));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Internal Server Error');
    });

    it('routes a THROWN error from a middleware to a registered 4-arg error handler', async () => {
      const adapter = new CloudflareAdapter();
      // A normal 3-arg middleware that throws synchronously instead of calling
      // next(err). In Express this is equivalent to next(err) and must reach
      // the downstream error handler, NOT the catch-all 500.
      adapter.useExpressMiddleware(() => {
        throw new Error('thrown-boom');
      });
      adapter.useExpressMiddleware(
        (
          failure: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          expect(next).toBeInstanceOf(Function);
          res.status(500).json({
            caught: failure instanceof Error ? failure.message : 'not an error',
          });
        },
      );
      adapter.get(
        '/thrown',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/thrown'),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ caught: 'thrown-boom' });
    });

    it('routes an async REJECTION from a middleware to a registered 4-arg error handler', async () => {
      const adapter = new CloudflareAdapter();
      adapter.useExpressMiddleware(async () => {
        await Promise.resolve();
        throw new Error('rejected-boom');
      });
      adapter.useExpressMiddleware(
        (
          failure: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          expect(next).toBeInstanceOf(Function);
          res.status(500).json({
            caught: failure instanceof Error ? failure.message : 'not an error',
          });
        },
      );
      adapter.get(
        '/rejected',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/rejected'),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ caught: 'rejected-boom' });
    });
  });
}

function registerMultipartAndFilters(): void {
  describe('malformed multipart body parsing', () => {
    it('does not produce an unhandled rejection on a malformed multipart body', async () => {
      const adapter = new CloudflareAdapter();
      let seenBody: unknown;
      adapter.post(
        '/upload',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          seenBody = req.body;
          adapter.reply(res, { ok: true });
        },
      );

      // A multipart content-type whose body has no/invalid boundary content:
      // request.formData() rejects. This parse runs before handle()'s
      // try/catch, so the adapter must guard it rather than let the whole
      // fetch handler reject.
      const res = await adapter.handle(
        new Request('https://example.com/upload', {
          method: 'POST',
          headers: {
            'content-type':
              'multipart/form-data; boundary=----nonexistentboundary',
          },
          body: 'this is not a valid multipart payload',
        }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      // The malformed body degrades to an empty object rather than crashing.
      expect(seenBody).toEqual({});
    });
  });

  describe('async exception filter via setErrorHandler', () => {
    it('awaits an async error handler before serializing the response', async () => {
      const adapter = new CloudflareAdapter();
      // An async exception filter: it awaits before writing the response, on a
      // later tick. handle() must await res.settled so the intended body is
      // produced before the Response is built.
      adapter.setErrorHandler(
        (failure: Error, _req, res: CloudflareResponse) => {
          void (async () => {
            await Promise.resolve();
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.body = JSON.stringify({ filtered: failure.message });
            res.sent = true;
            (res as CloudflareResponse & { settle: () => void }).settle();
          })();
        },
      );
      adapter.get('/boom', () => {
        throw new Error('handler-failed');
      });

      const res = await adapter.handle(new Request('https://example.com/boom'));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ filtered: 'handler-failed' });
    });
  });

  describe('mixed version array containing VERSION_NEUTRAL', () => {
    function mixedAdapter(): CloudflareAdapter {
      const adapter = new CloudflareAdapter();
      const options = {
        type: VersioningType.HEADER as const,
        header: 'x-api-version',
      };
      const handler = (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { matched: true });
      // ['1', VERSION_NEUTRAL] — a documented mixed array. NEUTRAL must only act
      // as a wildcard when the request supplies NO version.
      adapter.get(
        '/mixed',
        adapter.applyVersionFilter(handler, ['1', VERSION_NEUTRAL], options),
      );
      return adapter;
    }

    it('matches when the requested version is in the array', async () => {
      const res = await mixedAdapter().handle(
        new Request('https://example.com/mixed', {
          headers: { 'x-api-version': '1' },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ matched: true });
    });

    it('matches as a wildcard when NO version is supplied', async () => {
      const res = await mixedAdapter().handle(
        new Request('https://example.com/mixed'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ matched: true });
    });

    it('does NOT match a supplied version absent from the array (NEUTRAL is not a wildcard here)', async () => {
      const res = await mixedAdapter().handle(
        new Request('https://example.com/mixed', {
          headers: { 'x-api-version': '2' },
        }),
      );
      // Nest core falls through -> 404; the adapter must not wrongly dispatch.
      expect(res.status).toBe(404);
    });
  });

  describe('heterogeneous overlapping dynamic routes', () => {
    it("gives each fall-through handler its OWN params, not the first match's", async () => {
      const adapter = new CloudflareAdapter();
      // First route falls through via next(); second, differently-named route
      // must then run with ITS param name (`name`), not the first's (`id`).
      adapter.get(
        '/users/:id',
        (
          _req: CloudflareRequest,
          _res: CloudflareResponse,
          next: ExpressNextFunction,
        ) => next(),
      );
      adapter.get(
        '/users/:name',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, {
            id: req.params.id ?? null,
            name: req.params.name ?? null,
          });
        },
      );

      const res = await adapter.handle(
        new Request('https://example.com/users/42'),
      );
      expect(res.status).toBe(200);
      // The second handler must see {name:'42'}, with id absent.
      expect(await res.json()).toEqual({ id: null, name: '42' });
    });
  });

  describe('CORS headers on 404 responses', () => {
    it('keeps Access-Control-Allow-Origin on a 404 when CORS is enabled', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: '*' });
      // A no-op middleware so handle() builds the pipeline and applies CORS.
      adapter.use(
        (
          _req: CloudflareRequest,
          _res: CloudflareResponse,
          next: ExpressNextFunction,
        ) => next(),
      );

      const res = await adapter.handle(
        new Request('https://example.com/unknown', {
          headers: { origin: 'https://app.test' },
        }),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('keeps reflected ACAO + Vary on a 404 with a custom not-found handler', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: true });
      adapter.use(
        (
          _req: CloudflareRequest,
          _res: CloudflareResponse,
          next: ExpressNextFunction,
        ) => next(),
      );
      adapter.setNotFoundHandler((_req, res) => {
        res.status(404);
        res.json({ custom: true });
      });

      const res = await adapter.handle(
        new Request('https://example.com/unknown', {
          headers: { origin: 'https://app.test' },
        }),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://app.test',
      );
      expect(res.headers.get('vary')).toContain('Origin');
      expect(await res.json()).toEqual({ custom: true });
    });
  });
}

function registerMiddlewareScoping(): void {
  describe('Nest wildcard-scoped middleware (createMiddlewareFactory)', () => {
    function register(adapter: CloudflareAdapter, path: string): boolean[] {
      const ran: boolean[] = [];
      const factory = adapter.createMiddlewareFactory(RequestMethod.GET);
      factory(
        path,
        (
          _req: CloudflareRequest,
          _res: CloudflareResponse,
          next: () => void,
        ) => {
          ran.push(true);
          next();
        },
      );
      adapter.get(
        '/cats/a/b',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );
      adapter.get('/cats', (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      return ran;
    }

    it("runs middleware scoped to Nest's '/cats/{*path}' wildcard form", async () => {
      const adapter = new CloudflareAdapter();
      const ran = register(adapter, '/cats/{*path}');
      await adapter.handle(new Request('https://example.com/cats/a/b'));
      expect(ran).toHaveLength(1);
    });

    it("runs middleware scoped to Nest's '/cats/*path' wildcard form", async () => {
      const adapter = new CloudflareAdapter();
      const ran = register(adapter, '/cats/*path');
      await adapter.handle(new Request('https://example.com/cats/a/b'));
      expect(ran).toHaveLength(1);
    });

    it("treats Nest's whole-app '/{*path}' form as always-run", async () => {
      const adapter = new CloudflareAdapter();
      const ran: boolean[] = [];
      const factory = adapter.createMiddlewareFactory(RequestMethod.GET);
      factory(
        '/{*path}',
        (
          _req: CloudflareRequest,
          _res: CloudflareResponse,
          next: () => void,
        ) => {
          ran.push(true);
          next();
        },
      );
      adapter.get(
        '/anything',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );
      await adapter.handle(new Request('https://example.com/anything'));
      expect(ran).toHaveLength(1);
    });
  });

  describe('path-scoped middleware uses Express prefix (mount) semantics', () => {
    it('runs middleware mounted at /api for /api AND nested /api/users', async () => {
      const adapter = new CloudflareAdapter();
      const seen: string[] = [];
      adapter.use(
        '/api',
        (
          req: CloudflareRequest,
          _res: CloudflareResponse,
          next: ExpressNextFunction,
        ) => {
          seen.push(req.path ?? '');
          next();
        },
      );
      adapter.get('/api', (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      adapter.get(
        '/api/users',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );
      adapter.get(
        '/other',
        (_req: CloudflareRequest, res: CloudflareResponse) =>
          adapter.reply(res, { ok: true }),
      );

      await adapter.handle(new Request('https://example.com/api'));
      await adapter.handle(new Request('https://example.com/api/users'));
      await adapter.handle(new Request('https://example.com/other'));

      expect(seen).toEqual(['/api', '/api/users']);
    });
  });

  it('honours a custom not-found handler', async () => {
    const adapter = new CloudflareAdapter();
    // A middleware is needed so handle() builds a request pipeline rather than
    // short-circuiting; the not-found handler then formats the 404.
    adapter.use(
      (
        _req: CloudflareRequest,
        _res: CloudflareResponse,
        next: ExpressNextFunction,
      ) => next(),
    );
    adapter.setNotFoundHandler((_req, res) => {
      res.status(404);
      res.json({ custom: true });
    });

    const res = await adapter.handle(new Request('https://example.com/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ custom: true });
  });
}

describe('CloudflareAdapter fields, multipart and middleware scoping', () => {
  registerMutableFieldsAndErrors();
  registerMultipartAndFilters();
  registerMiddlewareScoping();
});
