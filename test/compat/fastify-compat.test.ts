import { describe, it, expect } from '@jest/globals';
import {
  createFastifyRequest,
  createFastifyReply,
  wrapFastifyHook,
  createFastifyLogger,
  type FastifyHook,
} from '../../src/compat/fastify-compat.js';
import type {
  CloudflareRequest,
  CloudflareResponse,
} from '../../src/adapters/cloudflare-adapter.js';

function mockRequest(
  overrides: Partial<CloudflareRequest> = {},
): CloudflareRequest {
  const headers = new Headers({
    'content-type': 'application/json',
    host: 'localhost',
  });
  return {
    raw: new Request('https://localhost/widgets/7'),
    url: '/widgets/7',
    method: 'POST',
    headers,
    params: { id: '7' },
    query: {},
    body: { name: 'gear' },
    cookies: {},
    files: {},
    ip: '127.0.0.1',
    hostname: 'localhost',
    protocol: 'https',
    secure: true,
    originalUrl: '/widgets/7',
    baseUrl: '',
    path: '/widgets/7',
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

describe('createFastifyRequest', () => {
  it('builds a Fastify-shaped request from a CloudflareRequest', () => {
    const req = createFastifyRequest(mockRequest());
    expect(req.method).toBe('POST');
    expect(req.params).toEqual({ id: '7' });
    expect(req.body).toEqual({ name: 'gear' });
    expect(req.protocol).toBe('https');
    expect(req.routerPath).toBe('/widgets/7');
    expect(typeof req.id).toBe('string');
  });
});

describe('createFastifyReply', () => {
  it('proxies code/header/send onto the CloudflareResponse', () => {
    const cfRes = mockResponse();
    const reply = createFastifyReply(cfRes);

    reply.code(202).header('x-trace', 'on').send({ accepted: true });

    expect(cfRes.statusCode).toBe(202);
    expect(cfRes.getHeader('x-trace')).toBe('on');
    expect(cfRes.body).toBe('{"accepted":true}');
    expect(reply.sent).toBe(true);
  });

  it('supports a custom serializer', () => {
    const cfRes = mockResponse();
    const reply = createFastifyReply(cfRes);
    reply.serializer(() => 'custom').send({ ignored: true });
    expect(cfRes.body).toBe('custom');
  });
});

describe('wrapFastifyHook', () => {
  it('runs an async hook and continues the chain', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    let ran = false;
    let nexted = false;

    const hook: FastifyHook = async (request, reply) => {
      ran = true;
      reply.header('x-hook', 'async');
      void request;
    };

    await wrapFastifyHook(hook)(cfReq, cfRes, () => {
      nexted = true;
    });

    expect(ran).toBe(true);
    expect(nexted).toBe(true);
    expect(cfRes.getHeader('x-hook')).toBe('async');
  });

  it('runs a callback-style hook and stops the chain when the reply is sent', async () => {
    const cfReq = mockRequest();
    const cfRes = mockResponse();
    let nexted = false;

    const hook: FastifyHook = (_request, reply, done) => {
      reply.code(403).send({ denied: true });
      done();
    };

    await wrapFastifyHook(hook)(cfReq, cfRes, () => {
      nexted = true;
    });

    expect(nexted).toBe(false);
    expect(cfRes.statusCode).toBe(403);
  });
});

describe('createFastifyLogger', () => {
  it('produces a logger with the expected methods and a child()', () => {
    const log = createFastifyLogger();
    expect(typeof log.info).toBe('function');
    const child = log.child({ reqId: '1' });
    expect(typeof child.error).toBe('function');
  });
});
