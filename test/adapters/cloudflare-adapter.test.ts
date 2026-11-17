import 'urlpattern-polyfill';
import { describe, it, expect } from '@jest/globals';
import { VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { CloudflareAdapter, FetchAdapter } from '../../src/index.js';
import type {
  CloudflareRequest,
  CloudflareResponse,
  ExpressNextFunction,
} from '../../src/index.js';

function registerBasicRouting(): void {
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
    const body: unknown = await res.json();
    expect(body).toMatchObject({ statusCode: 404, error: 'Not Found' });
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
    expect(seen?.files.file.name).toBe('a.txt');
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
}

function registerCorsAndStatic(): void {
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
    adapter.get(
      '/no-content',
      (_req: CloudflareRequest, res: CloudflareResponse) => {
        res.statusCode = 204;
        // a leftover body that the runtime would otherwise reject
        res.body = 'leftover';
        res.settle();
        res.sent = true;
      },
    );

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
    adapter.options(
      '/opt',
      (_req: CloudflareRequest, res: CloudflareResponse) => {
        adapter.reply(res, { handled: true });
      },
    );

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
}

function registerVersioningAndDeferred(): void {
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

      adapter.get('/versioned', adapter.applyVersionFilter(v1, '1', options));
      adapter.get('/versioned', adapter.applyVersionFilter(v2, '2', options));
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
        adapter.applyVersionFilter(neutral, VERSION_NEUTRAL, options),
      );

      const res = await adapter.handle(new Request('https://example.com/n'));
      expect(await res.json()).toEqual({ neutral: true });
    });

    it('still runs a plain single-handler route unchanged', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get(
        '/plain',
        (_req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { ok: true });
        },
      );
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
      adapter.get(
        '/deferred',
        (_req: CloudflareRequest, res: CloudflareResponse) => {
          setTimeout(() => {
            res.statusCode = 202;
            res.body = 'later';
            res.sent = true;
            res.settle();
          }, 0);
        },
      );

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
      adapter.get('/v', adapter.applyVersionFilter(v1, '1', options));
      adapter.get(
        '/v',
        adapter.applyVersionFilter(
          (_req: CloudflareRequest, res: CloudflareResponse) =>
            adapter.reply(res, { version: 'v2' }),
          '2',
          options,
        ),
      );

      const res = await Promise.race([
        adapter.handle(
          new Request('https://example.com/v', {
            headers: { 'x-api-version': '1' },
          }),
        ),
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(new Error('request hung')), 1000);
        }),
      ]);
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('later-v1');
    });
  });

  it('returns 404 when a lone handler falls through by calling next()', async () => {
    const adapter = new CloudflareAdapter();
    adapter.get(
      '/fall',
      (
        _req: CloudflareRequest,
        _res: CloudflareResponse,
        next: ExpressNextFunction,
      ) => next(),
    );

    const res = await adapter.handle(new Request('https://example.com/fall'));
    expect(res.status).toBe(404);
  });
}

function registerWildcardAndOrigin(): void {
  describe('wildcard / catch-all routes (path-to-regexp v8 syntax)', () => {
    it('matches @Get("{*path}") catch-all and captures the splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get(
        '/{*path}',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { path: req.params.path });
        },
      );

      const res = await adapter.handle(
        new Request('https://example.com/a/b/c'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: 'a/b/c' });
    });

    it('matches @Get("*path") catch-all and captures the splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get(
        '/*path',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { path: req.params.path });
        },
      );

      const res = await adapter.handle(new Request('https://example.com/x/y'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: 'x/y' });
    });

    it('matches a middle-segment splat', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get(
        '/files/{*rest}/download',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { rest: req.params.rest });
        },
      );

      const res = await adapter.handle(
        new Request('https://example.com/files/a/b/download'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ rest: 'a/b' });
    });

    it('unwraps a literal brace group in a route path', async () => {
      const adapter = new CloudflareAdapter();
      adapter.get(
        '/users/{list}/:id',
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { id: req.params.id });
        },
      );

      const res = await adapter.handle(
        new Request('https://example.com/users/list/7'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: '7' });
    });

    it('unwraps every brace group in a long route path', async () => {
      const adapter = new CloudflareAdapter();
      const segments = 2000;
      adapter.get(
        `${'/{s}'.repeat(segments)}/:id`,
        (req: CloudflareRequest, res: CloudflareResponse) => {
          adapter.reply(res, { id: req.params.id });
        },
      );

      const res = await adapter.handle(
        new Request(`https://example.com${'/s'.repeat(segments)}/9`),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: '9' });
    });
  });

  describe('CORS origin handling', () => {
    it('restricts a RegExp origin and does not reflect a non-matching one', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: EXAMPLE_COM_SUBDOMAIN });
      adapter.get('/r', (_req: CloudflareRequest, res: CloudflareResponse) =>
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
      const deniedOrigin = denied.headers.get('access-control-allow-origin');
      expect(deniedOrigin).not.toBe('*');
      expect(deniedOrigin).not.toBe('https://evil.com');
    });

    it('matches a RegExp entry inside an origin array', async () => {
      const adapter = new CloudflareAdapter();
      adapter.enableCors({ origin: ['https://a.test', EXAMPLE_COM_SUBDOMAIN] });
      adapter.get('/ra', (_req: CloudflareRequest, res: CloudflareResponse) =>
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
          done: (err: Error | null, allow?: boolean | string) => void,
        ) => done(null, true),
      });
      adapter.get('/cb', (_req: CloudflareRequest, res: CloudflareResponse) =>
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
      adapter.get('/v2', (_req: CloudflareRequest, res: CloudflareResponse) =>
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
}

/** Matches any origin ending in `.example.com`. */
const EXAMPLE_COM_SUBDOMAIN = /\.example\.com$/u;

describe('CloudflareAdapter routing, CORS, versioning and wildcards', () => {
  registerBasicRouting();
  registerCorsAndStatic();
  registerVersioningAndDeferred();
  registerWildcardAndOrigin();
});
