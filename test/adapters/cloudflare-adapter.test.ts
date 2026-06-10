import 'urlpattern-polyfill';
import { describe, it, expect } from '@jest/globals';
import { VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import {
  CloudflareAdapter,
  FetchAdapter,
  type CloudflareRequest,
  type CloudflareResponse,
} from '../../src/index.js';

describe('CloudflareAdapter', () => {
  it('reports its type as "fetch"', () => {
    expect(new CloudflareAdapter().getType()).toBe('fetch');
  });

  it('exposes FetchAdapter as a back-compat alias', () => {
    expect(FetchAdapter).toBe(CloudflareAdapter);
    expect(new FetchAdapter()).toBeInstanceOf(CloudflareAdapter);
  });

  it('returns 404 for an unregistered route', async () => {
    const adapter = new CloudflareAdapter();
    const res = await adapter.handle(
      new Request('https://example.com/missing'),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { statusCode: number; error: string };
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
  });

  it('routes a registered GET to its handler', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get(
      '/hello',
      (_req: CloudflareRequest, res: CloudflareResponse) => {
        adapter.reply(res, { message: 'hi' });
      },
    );

    const res = await adapter.handle(new Request('https://example.com/hello'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ message: 'hi' });
  });

  it('matches dynamic routes and extracts params via URLPattern', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get(
      '/users/:id',
      (req: CloudflareRequest, res: CloudflareResponse) => {
        adapter.reply(res, { id: req.params.id });
      },
    );

    const res = await adapter.handle(
      new Request('https://example.com/users/42'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: '42' });
  });

  it('parses a JSON body and exposes rawBody on POST', async () => {
    const adapter = new CloudflareAdapter();
    let seen: CloudflareRequest | undefined;
    adapter.post('/echo', (req: CloudflareRequest, res: CloudflareResponse) => {
      seen = req;
      adapter.reply(res, req.body);
    });

    const res = await adapter.handle(
      new Request('https://example.com/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
    expect(seen?.rawBody).toBeInstanceOf(Buffer);
    expect(seen?.rawBody?.toString()).toBe('{"a":1}');
  });

  it('parses urlencoded bodies into an object', async () => {
    const adapter = new CloudflareAdapter();
    adapter.post('/form', (req: CloudflareRequest, res: CloudflareResponse) => {
      adapter.reply(res, req.body);
    });

    const res = await adapter.handle(
      new Request('https://example.com/form', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=ada&lang=ts',
      }),
    );

    expect(await res.json()).toEqual({ name: 'ada', lang: 'ts' });
  });

  it('parses multipart bodies into fields and files', async () => {
    const adapter = new CloudflareAdapter();
    let seen: CloudflareRequest | undefined;
    adapter.post(
      '/upload',
      (req: CloudflareRequest, res: CloudflareResponse) => {
        seen = req;
        adapter.reply(res, { ok: true });
      },
    );

    const form = new FormData();
    form.append('field', 'value');
    form.append(
      'file',
      new File(['contents'], 'a.txt', { type: 'text/plain' }),
    );

    await adapter.handle(
      new Request('https://example.com/upload', { method: 'POST', body: form }),
    );

    expect(seen?.body).toEqual({ field: 'value' });
    expect(seen?.files.file).toBeInstanceOf(File);
    expect(seen?.files.file?.name).toBe('a.txt');
  });

  it('parses cookies from the Cookie header', async () => {
    const adapter = new CloudflareAdapter();
    let seen: CloudflareRequest | undefined;
    adapter.get('/c', (req: CloudflareRequest, res: CloudflareResponse) => {
      seen = req;
      adapter.reply(res, {});
    });

    await adapter.handle(
      new Request('https://example.com/c', {
        headers: { cookie: 'a=1; b=hello%20world' },
      }),
    );

    expect(seen?.cookies).toEqual({ a: '1', b: 'hello world' });
  });

  it('answers CORS preflight when CORS is enabled', async () => {
    const adapter = new CloudflareAdapter();
    adapter.enableCors({ origin: 'https://app.test', credentials: true });

    const res = await adapter.handle(
      new Request('https://example.com/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.test',
          'access-control-request-method': 'GET',
        },
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://app.test',
    );
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('applies CORS headers to non-preflight responses', async () => {
    const adapter = new CloudflareAdapter();
    adapter.enableCors({ origin: '*' });
    adapter.get('/x', (_req: CloudflareRequest, res: CloudflareResponse) => {
      adapter.reply(res, { ok: true });
    });

    const res = await adapter.handle(new Request('https://example.com/x'));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('runs registered middleware and short-circuits when it responds', async () => {
    const adapter = new CloudflareAdapter();
    adapter.use((_req: CloudflareRequest, res: CloudflareResponse) => {
      res.status(401);
      res.send('nope');
    });
    adapter.get(
      '/secure',
      (_req: CloudflareRequest, res: CloudflareResponse) => {
        adapter.reply(res, { ok: true });
      },
    );

    const res = await adapter.handle(new Request('https://example.com/secure'));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('nope');
  });

  it('supports redirect() on the response contract', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get('/go', (_req: CloudflareRequest, res: CloudflareResponse) => {
      adapter.redirect(res, 301, 'https://elsewhere.test/');
    });

    const res = await adapter.handle(new Request('https://example.com/go'));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://elsewhere.test/');
  });

  it('listen() does not bind a port but still fires its callback', async () => {
    const adapter = new CloudflareAdapter();
    adapter.initHttpServer();
    let called = false;
    adapter.listen(3000, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(adapter.getHttpServer()).toBeDefined();
  });

  it('useStaticAssets() is a documented no-op', () => {
    const adapter = new CloudflareAdapter();
    expect(() => adapter.useStaticAssets('/public')).not.toThrow();
  });

  it('serves a HEAD request from a GET route with an empty body', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get(
      '/thing',
      (_req: CloudflareRequest, res: CloudflareResponse) => {
        adapter.reply(res, { message: 'hi' });
      },
    );

    const res = await adapter.handle(
      new Request('https://example.com/thing', { method: 'HEAD' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('does not throw on a 204 response that still carries a body', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get('/no-content', (_req, res: CloudflareResponse) => {
      res.statusCode = 204;
      // a leftover body that the runtime would otherwise reject
      res.body = 'leftover';
      res.settle();
      res.sent = true;
    });

    const res = await adapter.handle(
      new Request('https://example.com/no-content'),
    );
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('reaches a user @Options() route when CORS is enabled and it is not a preflight', async () => {
    const adapter = new CloudflareAdapter();
    adapter.enableCors({ origin: '*' });
    adapter.options('/opt', (_req, res: CloudflareResponse) => {
      adapter.reply(res, { handled: true });
    });

    // Real preflight: carries access-control-request-method.
    const preflight = await adapter.handle(
      new Request('https://example.com/opt', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.test',
          'access-control-request-method': 'GET',
        },
      }),
    );
    expect(preflight.status).toBe(204);

    // Plain OPTIONS without the preflight header reaches the handler.
    const direct = await adapter.handle(
      new Request('https://example.com/opt', { method: 'OPTIONS' }),
    );
    expect(direct.status).toBe(200);
    expect(await direct.json()).toEqual({ handled: true });
  });

  it('collapses repeated query keys into arrays', async () => {
    const adapter = new CloudflareAdapter();
    let seen: CloudflareRequest | undefined;
    adapter.get('/q', (req: CloudflareRequest, res: CloudflareResponse) => {
      seen = req;
      adapter.reply(res, {});
    });

    await adapter.handle(new Request('https://example.com/q?a=1&a=2&b=3'));
    expect(seen?.query).toEqual({ a: ['1', '2'], b: '3' });
  });

  describe('header versioning', () => {
    function versionedAdapter(): CloudflareAdapter {
      const adapter = new CloudflareAdapter();
      const options = {
        type: VersioningType.HEADER as const,
        header: 'x-api-version',
      };

      const v1 = (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { version: 'v1' });
      const v2 = (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { version: 'v2' });

      adapter.get(
        '/versioned',
        adapter.applyVersionFilter(v1, '1', options) as never,
      );
      adapter.get(
        '/versioned',
        adapter.applyVersionFilter(v2, '2', options) as never,
      );
      return adapter;
    }

    it('routes to the handler matching the requested version', async () => {
      const adapter = versionedAdapter();
      const res = await adapter.handle(
        new Request('https://example.com/versioned', {
          headers: { 'x-api-version': '1' },
        }),
      );
      expect(await res.json()).toEqual({ version: 'v1' });
    });

    it('routes to the other handler for the other version', async () => {
      const adapter = versionedAdapter();
      const res = await adapter.handle(
        new Request('https://example.com/versioned', {
          headers: { 'x-api-version': '2' },
        }),
      );
      expect(await res.json()).toEqual({ version: 'v2' });
    });

    it('falls through to 404 when no version matches', async () => {
      const adapter = versionedAdapter();
      const res = await adapter.handle(
        new Request('https://example.com/versioned'),
      );
      expect(res.status).toBe(404);
    });

    it('treats VERSION_NEUTRAL as always-matching', async () => {
      const adapter = new CloudflareAdapter();
      const options = {
        type: VersioningType.HEADER as const,
        header: 'x-api-version',
      };
      const neutral = (_req: CloudflareRequest, res: CloudflareResponse) =>
        adapter.reply(res, { neutral: true });
      adapter.get(
        '/n',
        adapter.applyVersionFilter(neutral, VERSION_NEUTRAL, options) as never,
      );

      const res = await adapter.handle(new Request('https://example.com/n'));
      expect(await res.json()).toEqual({ neutral: true });
    });

    it('still runs a plain single-handler route unchanged', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get('/plain', (_req, res: CloudflareResponse) => {
        adapter.reply(res, { ok: true });
      });
      const res = await adapter.handle(
        new Request('https://example.com/plain'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  describe('deferred-settle handlers', () => {
    it('supports a deferred-settle handler on a non-versioned route', async () => {
      const adapter = new CloudflareAdapter();
      // Returns synchronously, then settles the response on a later tick — the
      // documented @Res()/streaming pattern.
      adapter.get('/deferred', (_req, res: CloudflareResponse) => {
        setTimeout(() => {
          res.statusCode = 202;
          res.body = 'later';
          res.sent = true;
          res.settle();
        }, 0);
      });

      const res = await adapter.handle(
        new Request('https://example.com/deferred'),
      );
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('later');
    });

    it('supports a deferred-settle handler on a versioned route (no hang)', async () => {
      const adapter = new CloudflareAdapter();
      const options = {
        type: VersioningType.HEADER as const,
        header: 'x-api-version',
      };
      const v1 = (_req: CloudflareRequest, res: CloudflareResponse) => {
        setTimeout(() => {
          res.statusCode = 202;
          res.body = 'later-v1';
          res.sent = true;
          res.settle();
        }, 0);
      };
      // Two version chains so the multi-handler dispatch branch is exercised.
      adapter.get('/v', adapter.applyVersionFilter(v1, '1', options) as never);
      adapter.get(
        '/v',
        adapter.applyVersionFilter(
          (_req: CloudflareRequest, res: CloudflareResponse) =>
            adapter.reply(res, { version: 'v2' }),
          '2',
          options,
        ) as never,
      );

      const res = await Promise.race([
        adapter.handle(
          new Request('https://example.com/v', {
            headers: { 'x-api-version': '1' },
          }),
        ),
        new Promise<Response>((_r, reject) =>
          setTimeout(() => reject(new Error('request hung')), 1000),
        ),
      ]);
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('later-v1');
    });
  });

  it('returns 404 when a lone handler falls through by calling next()', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get('/fall', (_req, _res, next) => next());

    const res = await adapter.handle(new Request('https://example.com/fall'));
    expect(res.status).toBe(404);
  });

  describe('wildcard / catch-all routes (path-to-regexp v8 syntax)', () => {
    it('matches @Get("{*path}") catch-all and captures the splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get('/{*path}', (req: CloudflareRequest, res) => {
        adapter.reply(res, { path: req.params.path });
      });

      const res = await adapter.handle(
        new Request('https://example.com/a/b/c'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: 'a/b/c' });
    });

    it('matches @Get("*path") catch-all and captures the splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get('/*path', (req: CloudflareRequest, res) => {
        adapter.reply(res, { path: req.params.path });
      });

      const res = await adapter.handle(new Request('https://example.com/x/y'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: 'x/y' });
    });

    it('matches a middle-segment splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get('/files/{*rest}/download', (req: CloudflareRequest, res) => {
        adapter.reply(res, { rest: req.params.rest });
      });

      const res = await adapter.handle(
        new Request('https://example.com/files/a/b/download'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ rest: 'a/b' });
    });
  });

  describe('CORS origin handling', () => {
    it('restricts a RegExp origin and does not reflect a non-matching one', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: /\.example\.com$/ });
      adapter.get('/r', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const allowed = await adapter.handle(
        new Request('https://example.com/r', {
          headers: { origin: 'https://app.example.com' },
        }),
      );
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );

      const denied = await adapter.handle(
        new Request('https://example.com/r', {
          headers: { origin: 'https://evil.com' },
        }),
      );
      // Must NOT be '*' — that would defeat the restriction.
      expect(denied.headers.get('access-control-allow-origin')).not.toBe('*');
      expect(denied.headers.get('access-control-allow-origin')).not.toBe(
        'https://evil.com',
      );
    });

    it('matches a RegExp entry inside an origin array', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: ['https://a.test', /\.example\.com$/] });
      adapter.get('/ra', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/ra', {
          headers: { origin: 'https://app.example.com' },
        }),
      );
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );
    });

    it('supports a callback-style CustomOrigin function', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({
        origin: (
          _origin: string,
          cb: (err: Error | null, allow?: boolean | string) => void,
        ) => cb(null, true),
      });
      adapter.get('/cb', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/cb', {
          headers: { origin: 'https://caller.test' },
        }),
      );
      // Must not 500; reflects the request origin.
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://caller.test',
      );
    });

    it('sets Vary: Origin when the allow-origin is reflected', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: true });
      adapter.get('/v2', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/v2', {
          headers: { origin: 'https://app.test' },
        }),
      );
      expect(res.headers.get('vary')).toContain('Origin');
    });

    it('sets Vary on a CORS preflight response', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: 'https://app.test' });

      const res = await adapter.handle(
        new Request('https://example.com/anything', {
          method: 'OPTIONS',
          headers: {
            origin: 'https://app.test',
            'access-control-request-method': 'GET',
          },
        }),
      );
      const vary = res.headers.get('vary') ?? '';
      expect(vary).toContain('Origin');
      expect(vary).toContain('Access-Control-Request-Headers');
    });
  });

  describe('mutable per-request fields (no frozen sentinel)', () => {
    it('allows middleware to write to req.query when there is no query string', async () => {
      const adapter = new CloudflareAdapter();
      let threw = false;
      adapter.use((req: CloudflareRequest, _res, next) => {
        try {
          (req.query as Record<string, unknown>).page = '1';
        } catch {
          threw = true;
        }
        next();
      });
      adapter.get('/m', (req: CloudflareRequest, res) =>
        adapter.reply(res, { page: req.query.page }),
      );

      const res = await adapter.handle(new Request('https://example.com/m'));
      expect(threw).toBe(false);
      expect(await res.json()).toEqual({ page: '1' });
    });

    it('allows handlers to write to req.params on a non-parametric route', async () => {
      const adapter = new CloudflareAdapter();
      let threw = false;
      adapter.get('/p', (req: CloudflareRequest, res) => {
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
      adapter.get('/fc', (req: CloudflareRequest, res) => {
        try {
          (req.cookies as Record<string, string>).sid = 'x';
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
      adapter.useExpressMiddleware((_req, _res, next) => {
        next(new Error('boom'));
      });
      // A standalone 4-arg Express error handler that catches it and responds.
      // Express identifies error handlers by arity (4 params), so all four
      // must be declared even though `next` is unused here.
      adapter.useExpressMiddleware(
        (
          err: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          void next; // declared only to mark this as a 4-arg error handler
          res.status(500).json({ caught: (err as Error).message });
        },
      );
      adapter.get('/x', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(new Request('https://example.com/x'));
      expect(res.status).toBe(500);
      // Must be the custom error handler's body, NOT the generic 500 string.
      expect(await res.json()).toEqual({ caught: 'boom' });
    });

    it('falls through to the generic 500 when no error handler is registered', async () => {
      const adapter = new CloudflareAdapter();
      adapter.useExpressMiddleware((_req, _res, next) => {
        next(new Error('unhandled'));
      });
      adapter.get('/y', (_req, res: CloudflareResponse) =>
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
          err: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          void next; // declared only to mark this as a 4-arg error handler
          res.status(500).json({ caught: (err as Error).message });
        },
      );
      adapter.get('/thrown', (_req, res: CloudflareResponse) =>
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
          err: unknown,
          _req: unknown,
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: unknown,
        ) => {
          void next; // declared only to mark this as a 4-arg error handler
          res.status(500).json({ caught: (err as Error).message });
        },
      );
      adapter.get('/rejected', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );

      const res = await adapter.handle(
        new Request('https://example.com/rejected'),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ caught: 'rejected-boom' });
    });
  });

  describe('malformed multipart body parsing', () => {
    it('does not produce an unhandled rejection on a malformed multipart body', async () => {
      const adapter = new CloudflareAdapter();
      let seenBody: unknown;
      adapter.post('/upload', (req: CloudflareRequest, res) => {
        seenBody = req.body;
        adapter.reply(res, { ok: true });
      });

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
      adapter.setErrorHandler((error: Error, _req, res: CloudflareResponse) => {
        void (async () => {
          await Promise.resolve();
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.body = JSON.stringify({ filtered: error.message });
          res.sent = true;
          (res as CloudflareResponse & { settle: () => void }).settle();
        })();
      });
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
        adapter.applyVersionFilter(
          handler,
          ['1', VERSION_NEUTRAL],
          options,
        ) as never,
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
      adapter.get('/users/:id', (_req, _res, next) => next());
      adapter.get('/users/:name', (req: CloudflareRequest, res) => {
        adapter.reply(res, {
          id: req.params.id ?? null,
          name: req.params.name ?? null,
        });
      });

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
      adapter.use((_req, _res, next) => next());

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
      adapter.use((_req, _res, next) => next());
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

  describe('Nest wildcard-scoped middleware (createMiddlewareFactory)', () => {
    function register(adapter: CloudflareAdapter, path: string): boolean[] {
      const ran: boolean[] = [];
      const factory = adapter.createMiddlewareFactory(0 as never);
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
      adapter.get('/cats/a/b', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      adapter.get('/cats', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      return ran;
    }

    it("runs middleware scoped to Nest's '/cats/{*path}' wildcard form", async () => {
      const adapter = new CloudflareAdapter();
      const ran = register(adapter, '/cats/{*path}');
      await adapter.handle(new Request('https://example.com/cats/a/b'));
      expect(ran.length).toBe(1);
    });

    it("runs middleware scoped to Nest's '/cats/*path' wildcard form", async () => {
      const adapter = new CloudflareAdapter();
      const ran = register(adapter, '/cats/*path');
      await adapter.handle(new Request('https://example.com/cats/a/b'));
      expect(ran.length).toBe(1);
    });

    it("treats Nest's whole-app '/{*path}' form as always-run", async () => {
      const adapter = new CloudflareAdapter();
      const ran: boolean[] = [];
      const factory = adapter.createMiddlewareFactory(0 as never);
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
      adapter.get('/anything', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      await adapter.handle(new Request('https://example.com/anything'));
      expect(ran.length).toBe(1);
    });
  });

  describe('path-scoped middleware uses Express prefix (mount) semantics', () => {
    it('runs middleware mounted at /api for /api AND nested /api/users', async () => {
      const adapter = new CloudflareAdapter();
      const seen: string[] = [];
      adapter.use('/api', (req: CloudflareRequest, _res, next) => {
        seen.push(req.path ?? '');
        next();
      });
      adapter.get('/api', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      adapter.get('/api/users', (_req, res: CloudflareResponse) =>
        adapter.reply(res, { ok: true }),
      );
      adapter.get('/other', (_req, res: CloudflareResponse) =>
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
    adapter.use((_req, _res, next) => next());
    adapter.setNotFoundHandler((_req, res) => {
      res.status(404);
      res.json({ custom: true });
    });

    const res = await adapter.handle(new Request('https://example.com/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ custom: true });
  });
});
