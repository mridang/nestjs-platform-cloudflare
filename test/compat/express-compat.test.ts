import { describe, it, expect } from '@jest/globals';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import {
  createExpressRequest,
  createExpressResponse,
  wrapExpressMiddleware,
  type ExpressMiddleware,
  type ExpressErrorMiddleware,
} from '../../src/compat/express-compat.js';
import type {
  CloudflareRequest,
  CloudflareResponse,
} from '../../src/adapters/cloudflare-adapter.js';

function mockRequest(
  overrides: Partial<CloudflareRequest> = {},
): CloudflareRequest {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
    host: 'localhost',
    cookie: 'sid=abc123',
  });
  return {
    raw: new Request('https://localhost/test?foo=bar'),
    url: '/test?foo=bar',
    method: 'GET',
    headers,
    params: { id: '123' },
    query: { foo: 'bar' },
    body: { data: 'test' },
    cookies: {},
    files: {},
    ip: '127.0.0.1',
    hostname: 'localhost',
    protocol: 'https',
    secure: true,
    originalUrl: '/test?foo=bar',
    baseUrl: '',
    path: '/test',
    get: (name) => headers.get(name),
    ...overrides,
  };
}

function mockResponse(): CloudflareResponse {
  const headers = new Headers();
  const res: CloudflareResponse = {
    statusCode: 200,
    headers,
    body: null,
    headersSent: false,
    sent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      headers.set(name, value);
      return res;
    },
    getHeader(name) {
      return headers.get(name);
    },
    getSetCookie() {
      const h = headers as Headers & { getSetCookie?: () => string[] };
      if (typeof h.getSetCookie === 'function') {
        return h.getSetCookie();
      }
      const raw = headers.get('set-cookie');
      return raw ? [raw] : [];
    },
    removeHeader(name) {
      headers.delete(name);
      return res;
    },
    send(body) {
      res.sent = true;
      res.headersSent = true;
      res.body = (body ?? null) as typeof res.body;
    },
    json(body) {
      res.sent = true;
      res.headersSent = true;
      headers.set('content-type', 'application/json');
      res.body = JSON.stringify(body);
    },
    redirect(url, code = 302) {
      res.sent = true;
      res.statusCode = code;
      headers.set('location', url);
    },
    end(body) {
      res.sent = true;
      res.headersSent = true;
      res.body = body ?? null;
    },
    settle() {},
  };
  return res;
}

describe('createExpressRequest', () => {
  it('builds an Express-shaped request from a CloudflareRequest', () => {
    const req = createExpressRequest(mockRequest());
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/test');
    expect(req.originalUrl).toBe('/test?foo=bar');
    expect(req.query).toEqual({ foo: 'bar' });
    expect(req.params).toEqual({ id: '123' });
    expect(req.secure).toBe(true);
    expect(req.protocol).toBe('https');
  });

  it('exposes header accessors and content negotiation', () => {
    const req = createExpressRequest(mockRequest());
    expect(req.get('content-type')).toBe('application/json');
    expect(req.header('accept')).toBe('application/json');
    expect(req.is('application/json')).toBe('application/json');
    expect(req.accepts('application/json')).toBe('application/json');
    expect(req.accepts('text/html')).toBe(false);
  });

  it('parses cookies from the cookie header', () => {
    const req = createExpressRequest(mockRequest());
    expect(req.cookies).toEqual({ sid: 'abc123' });
  });

  it('does not mark a request fresh merely because it carries conditional headers', () => {
    const headers = new Headers({
      'if-modified-since': 'Wed, 01 Jan 2025 00:00:00 GMT',
      'if-none-match': '"abc"',
    });
    const req = createExpressRequest(
      mockRequest({ headers, get: (name) => headers.get(name) }),
    );
    // No response validators were compared, so Express's safe default applies.
    expect(req.fresh).toBe(false);
    expect(req.stale).toBe(true);
  });
});

describe('createExpressResponse', () => {
  it('proxies status, headers and json onto the CloudflareResponse', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);

    res.status(201).set('x-custom', 'yes').json({ ok: true });

    expect(cfRes.statusCode).toBe(201);
    expect(cfRes.getHeader('x-custom')).toBe('yes');
    expect(cfRes.body).toBe('{"ok":true}');
  });

  it('serializes cookies via the Set-Cookie header', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);
    res.cookie('token', 'xyz', { httpOnly: true, path: '/' });
    expect(cfRes.getHeader('Set-Cookie')).toContain('token=xyz');
    expect(cfRes.getHeader('Set-Cookie')).toContain('HttpOnly');
  });

  it('setHeader() with an array REPLACES rather than appends (Node semantics)', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);
    res.setHeader('Set-Cookie', ['a=1', 'b=2']);
    res.setHeader('Set-Cookie', ['c=3']);
    // Must be only the second write — not 'a=1, b=2, c=3'.
    expect(cfRes.getSetCookie()).toEqual(['c=3']);
  });

  it('set() with an array REPLACES rather than appends (Vary)', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);
    res.set('Vary', ['Accept']);
    res.set('Vary', ['Origin']);
    expect(cfRes.getHeader('Vary')).toBe('Origin');
  });

  it('getHeader("set-cookie") returns the array form, not a comma-joined string', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);
    // A cookie whose value legitimately contains commas (Expires).
    res.setHeader('Set-Cookie', [
      'sid=1; Expires=Wed, 01 Jan 2025 00:00:00 GMT',
      'other=2',
    ]);
    const read = res.getHeader('set-cookie');
    expect(Array.isArray(read)).toBe(true);
    expect(read).toEqual([
      'sid=1; Expires=Wed, 01 Jan 2025 00:00:00 GMT',
      'other=2',
    ]);
  });

  it('get("set-cookie") returns the array form for Express middleware', () => {
    const cfRes = mockResponse();
    const res = createExpressResponse(cfRes);
    res.cookie('a', '1');
    res.cookie('b', '2');
    const read = res.get('set-cookie') as unknown as string[];
    expect(Array.isArray(read)).toBe(true);
    expect(read.length).toBe(2);
  });
});

describe('wrapExpressMiddleware', () => {
  it('runs a real helmet() middleware and sets security headers', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const wrapped = wrapExpressMiddleware(
      helmet() as unknown as ExpressMiddleware,
    );

    let nexted = false;
    await wrapped(cfReq, cfRes, () => {
      nexted = true;
    });

    expect(nexted).toBe(true);
    expect(cfRes.getHeader('X-Content-Type-Options')).toBe('nosniff');
  });

  it('runs a real cookie-parser and populates req.cookies', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const parser = cookieParser() as unknown as ExpressMiddleware;

    // cookie-parser reads from the same wrapped express request each call, so
    // assert by capturing it from a follow-on middleware.
    let captured: Record<string, string> | undefined;
    const wrappedParser = wrapExpressMiddleware(parser);
    await wrappedParser(cfReq, cfRes, () => {});

    const capture: ExpressMiddleware = (req, _res, next) => {
      captured = req.cookies as Record<string, string>;
      next();
    };
    await wrapExpressMiddleware(capture)(cfReq, cfRes, () => {});

    expect(captured).toMatchObject({ sid: 'abc123' });
  });

  it('resolves when a sync middleware ends the response without calling next()', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const guard: ExpressMiddleware = (_req, res) => {
      res.status(401).end('nope');
    };

    await wrapExpressMiddleware(guard)(cfReq, cfRes, () => {});

    expect(cfRes.statusCode).toBe(401);
    expect(cfRes.sent).toBe(true);
  });

  it('resolves when an async middleware ends the response without calling next()', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const guard: ExpressMiddleware = async (_req, res) => {
      await Promise.resolve();
      res.status(401).end('nope');
    };

    await wrapExpressMiddleware(guard)(cfReq, cfRes, () => {});

    expect(cfRes.statusCode).toBe(401);
    expect(cfRes.sent).toBe(true);
  });

  it('forwards next(err) to the chain-level next so a downstream error handler can run', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const boom: ExpressMiddleware = (_req, _res, next) =>
      next(new Error('boom'));

    // The wrapper no longer rejects in isolation: it surfaces the error to its
    // chain-level next(err) so the adapter's error-aware middleware runner can
    // route it forward to a registered 4-arg error handler. The wrapper's own
    // promise resolves once control has passed on.
    let forwarded: unknown;
    await expect(
      wrapExpressMiddleware(boom)(cfReq, cfRes, (err?: unknown) => {
        forwarded = err;
      }),
    ).resolves.toBeUndefined();
    expect(forwarded).toBeInstanceOf(Error);
    expect((forwarded as Error).message).toBe('boom');
  });

  it('does not invoke a 4-arg error handler on the normal (non-error) path', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    let called = false;
    // A documented Express error handler: 4 args. On a normal request Express
    // never runs it; the wrapper must advance the chain instead of calling it
    // with shifted args (which would throw "next is not a function").
    const errorHandler: ExpressErrorMiddleware = (_err, _req, _res, next) => {
      called = true;
      next();
    };

    let nexted = false;
    await expect(
      wrapExpressMiddleware(errorHandler)(cfReq, cfRes, () => {
        nexted = true;
      }),
    ).resolves.toBeUndefined();

    expect(called).toBe(false);
    expect(nexted).toBe(true);
  });

  it('runs a 4-arg error handler when an error is propagated in, and resolves once it responds', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    let seenErr: unknown;
    // A 4-arg error handler that HANDLES the error by responding — the common
    // csurf/global-error-handler pattern. The wrapper must invoke it with the
    // propagated error (4th arg) and resolve once the response is produced,
    // rather than hanging.
    const errorHandler: ExpressErrorMiddleware = (err, _req, res, next) => {
      void next; // declared only to mark this as a 4-arg error handler
      seenErr = err;
      res.status(500).json({ caught: (err as Error).message });
    };
    const wrapped = wrapExpressMiddleware(errorHandler);
    expect(wrapped.isExpressErrorMiddleware).toBe(true);

    await expect(
      wrapped(cfReq, cfRes, () => {}, new Error('handled')),
    ).resolves.toBeUndefined();
    expect((seenErr as Error).message).toBe('handled');
    expect(cfRes.statusCode).toBe(500);
    expect(cfRes.sent).toBe(true);

    // Confirm it is NOT called on a normal pass (no propagated error): it just
    // advances the chain.
    seenErr = undefined;
    let nexted = false;
    await wrapped(cfReq, mockResponse(), () => {
      nexted = true;
    });
    expect(seenErr).toBeUndefined();
    expect(nexted).toBe(true);
  });

  it('forwards a synchronous throw to next(err) instead of rejecting (Express compat)', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const boom: ExpressMiddleware = () => {
      throw new Error('sync-boom');
    };

    // In real Express, `throw` inside a middleware is equivalent to next(err):
    // it must be forwarded to the chain so a downstream error handler can run,
    // NOT rejected (which would skip straight to the catch-all 500).
    let forwarded: unknown;
    await expect(
      wrapExpressMiddleware(boom)(cfReq, cfRes, (err?: unknown) => {
        forwarded = err;
      }),
    ).resolves.toBeUndefined();
    expect((forwarded as Error).message).toBe('sync-boom');
  });

  it('forwards an async rejection to next(err) instead of rejecting (Express compat)', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const boom: ExpressMiddleware = async () => {
      await Promise.resolve();
      throw new Error('async-boom');
    };

    let forwarded: unknown;
    await expect(
      wrapExpressMiddleware(boom)(cfReq, cfRes, (err?: unknown) => {
        forwarded = err;
      }),
    ).resolves.toBeUndefined();
    expect((forwarded as Error).message).toBe('async-boom');
  });

  it('forwards a throw from a 4-arg error handler to next(err)', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const rethrow: ExpressErrorMiddleware = (_err, _req, _res, next) => {
      void next;
      throw new Error('rethrown');
    };

    let forwarded: unknown;
    await expect(
      wrapExpressMiddleware(rethrow)(
        cfReq,
        cfRes,
        (err?: unknown) => {
          forwarded = err;
        },
        new Error('original'),
      ),
    ).resolves.toBeUndefined();
    expect((forwarded as Error).message).toBe('rethrown');
  });

  it('resolves when an async 4-arg error handler responds to a propagated error', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    const errorHandler: ExpressErrorMiddleware = async (
      err,
      _req,
      res,
      next,
    ) => {
      void next; // declared only to mark this as a 4-arg error handler
      await Promise.resolve();
      res.status(403).json({ caught: (err as Error).message });
    };
    const wrapped = wrapExpressMiddleware(errorHandler);

    await expect(
      wrapped(cfReq, cfRes, () => {}, new Error('async-handled')),
    ).resolves.toBeUndefined();
    expect(cfRes.statusCode).toBe(403);
    expect(cfRes.sent).toBe(true);
  });
});

describe('createExpressRequest mutable query/params', () => {
  it('lets middleware mutate req.query even when backed by a frozen empty', () => {
    // Simulate the adapter handing out a frozen empty object (the previous bug)
    const frozenEmpty = Object.freeze({}) as Record<string, never>;
    const cfReq = mockRequest({
      query: frozenEmpty,
      params: frozenEmpty,
    });
    const req = createExpressRequest(cfReq);

    // Must be a fresh copy, not the frozen singleton — writes must not throw.
    expect(() => {
      (req.query as Record<string, unknown>).page = '1';
    }).not.toThrow();
    expect(() => {
      req.params.tenant = 'acme';
    }).not.toThrow();
    expect(req.query.page).toBe('1');
    expect(req.params.tenant).toBe('acme');
  });
});
