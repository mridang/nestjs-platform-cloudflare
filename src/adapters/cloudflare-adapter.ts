import { AbstractHttpAdapter } from '@nestjs/core';
import { Buffer } from 'node:buffer';
import { RequestMethod, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { VersioningOptions } from '@nestjs/common';
import type {
  CloudflareHttpServer,
  CloudflareCorsOptions,
  CloudflareStaticAssetsOptions,
} from '../interfaces/cloudflare-http-options.interface.js';
import {
  wrapExpressMiddleware,
  createExpressRequest,
  createExpressResponse,
  type ExpressMiddleware,
  type ExpressErrorMiddleware,
  type ExpressLikeApp,
} from '../compat/express-compat.js';
import {
  wrapFastifyHook,
  wrapFastifyPlugin,
  createFastifyRequest,
  createFastifyReply,
  createFastifyLogger,
  type FastifyHook,
  type FastifyPlugin,
  type FastifyPluginAsync,
  type FastifyLikeInstance,
  type FastifyRouteHandler,
  type FastifyRouteOptions,
  type FastifyErrorHook,
  type FastifyOnSendHook,
  type FastifyHookName,
} from '../compat/fastify-compat.js';

/** Mirror of Nest's VersionValue (not re-exported from the package root). */
type VersionValue =
  | string
  | typeof VERSION_NEUTRAL
  | Array<string | typeof VERSION_NEUTRAL>;

/**
 * Minimal shape of a `URLPattern` instance for `tsc`. `URLPattern` is a native
 * Workers global; only the members the adapter uses are declared.
 *
 * Optional groups that don't match are present with value `undefined` on the
 * native runtime, so the groups map is typed to allow `undefined`.
 */
interface URLPatternInstance {
  /**
   * Match a URL and return its captured path groups, or `null` on no match.
   * @param input The URL (or URL string) to match.
   * @returns The match result, or `null` if the pattern does not match.
   */
  exec(
    input: string | URL,
  ): { pathname: { groups: Record<string, string | undefined> } } | null;
  /**
   * Test whether a URL matches the pattern.
   * @param input The URL (or URL string) to test.
   * @returns `true` if the pattern matches.
   */
  test(input: string | URL): boolean;
}

/** Ambient declaration of the native Workers `URLPattern` constructor. */
declare const URLPattern: {
  new (init: { pathname: string }): URLPatternInstance;
};

// Promise.withResolvers (ES2024) — declared ambiently to avoid pulling the
// ESNext lib, which conflicts with @types/node's iterator typings here.
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

/**
 * Extended request object exposed by the Cloudflare adapter.
 *
 * It is built from a native Web `Request` and carries the Express/Fastify
 * shaped fields that Nest and the compat layers read. The compat helpers in
 * `../compat/*` operate on this type.
 */
export interface CloudflareRequest {
  /** The underlying native Web `Request`. */
  readonly raw: Request;
  /** Request URL as path plus query string. */
  readonly url: string;
  /** HTTP method of the request. */
  readonly method: string;
  /** Native request headers. */
  readonly headers: Headers;
  /** Route parameters from the matched path; reassigned per matched handler. */
  params: Record<string, string | undefined>;
  /** Parsed query string, with repeated keys collected into arrays. */
  readonly query: Record<string, string | string[]>;
  /** Parsed request body, set by native body parsing. */
  body?: unknown;
  /** Raw body bytes, present when the body was read as a buffer. */
  rawBody?: Buffer;
  /** Uploaded files keyed by field name (multipart requests). */
  files: Record<string, File>;
  /** Parsed request cookies keyed by name. */
  cookies: Record<string, string>;
  /** Client IP address (from `cf-connecting-ip`), when available. */
  ip?: string;
  /** Host name derived from the request URL. */
  hostname?: string;
  /** Request protocol (always `https` on Workers). */
  protocol?: string;
  /** Whether the request used a secure connection. */
  secure?: boolean;
  /** Original request URL before any internal rewriting. */
  originalUrl?: string;
  /** Mount path the request was matched under (empty for the root app). */
  baseUrl?: string;
  /** Request path without the query string. */
  path?: string;
  /**
   * Read a request header value by name (case-insensitive).
   * @param name Header name.
   * @returns The header value, or `null` if absent.
   */
  get(name: string): string | null;
}

/**
 * Extended response object exposed by the Cloudflare adapter.
 *
 * It buffers status, headers and body and is converted into a native Web
 * `Response` once the Nest pipeline settles. The compat helpers in
 * `../compat/*` operate on this type.
 */
export interface CloudflareResponse {
  /** Buffered HTTP status code. */
  statusCode: number;
  /** Buffered response headers. */
  headers: Headers;
  /** Buffered response body, or `null` for an empty body. */
  // eslint-disable-next-line no-undef
  body?: BodyInit | null;
  /** Whether the headers have been committed. */
  headersSent: boolean;
  /** Whether a response body has been produced. */
  sent: boolean;
  /**
   * Set the status code.
   * @param code HTTP status code.
   * @returns This response, for chaining.
   */
  status(code: number): this;
  /**
   * Set a header value, replacing any existing value.
   * @param name Header name.
   * @param value Header value.
   * @returns This response, for chaining.
   */
  setHeader(name: string, value: string): this;
  /**
   * Read a header value.
   * @param name Header name.
   * @returns The header value, or `null` if absent.
   */
  getHeader(name: string): string | null;
  /**
   * Return the `Set-Cookie` header as the array Express/Node middleware expect.
   * Set-Cookie values legitimately contain commas (e.g. `Expires=Wed, 01 ...`),
   * so a comma-joined `headers.get('set-cookie')` is unparseable — callers that
   * read back accumulated cookies must use this instead.
   * @returns The accumulated `Set-Cookie` values.
   */
  getSetCookie(): string[];
  /**
   * Remove a header.
   * @param name Header name.
   * @returns This response, for chaining.
   */
  removeHeader(name: string): this;
  /**
   * Buffer a response body, JSON-encoding plain objects and settling the
   * response.
   * @param body Body to send.
   */
  // eslint-disable-next-line no-undef
  send(body?: BodyInit | object | null): void;
  /**
   * Buffer a JSON response body and settle the response.
   * @param body Value to serialize as JSON.
   */
  json(body: unknown): void;
  /**
   * Buffer a redirect response and settle.
   * @param url Target location.
   * @param statusCode Redirect status code (defaults to 302).
   */
  redirect(url: string, statusCode?: number): void;
  /**
   * End the response, optionally with a final body, and settle.
   * @param body Optional final body.
   */
  // eslint-disable-next-line no-undef
  end(body?: BodyInit | null): void;
  /** Resolve the internal settled promise (set once a body is produced). */
  settle(): void;
}

/**
 * A buffered {@link CloudflareResponse} that also carries the internal
 * `settled` promise {@link CloudflareAdapter.handle} awaits for
 * deferred-settle handlers (e.g. `@Res()` controllers).
 */
type BufferedResponse = CloudflareResponse & {
  /** Resolves once a body has been produced. */
  readonly settled: Promise<void>;
};

/** A connect-style continuation callback; an error short-circuits the chain. */
type Next = (err?: unknown) => void;

/** A request handler in the adapter's internal `(req, res, next)` shape. */
type Handler = (
  req: CloudflareRequest,
  res: CloudflareResponse,
  next: Next,
) => unknown;

/** Route parameters extracted from a matched path. */
type Params = Record<string, string | undefined>;

/** A parametric route: its compiled `URLPattern` and the handler to run. */
type DynamicRoute = {
  /** Compiled pattern matched against the request URL. */
  readonly pattern: URLPatternInstance;
  /** Handler invoked when the pattern matches. */
  readonly handler: Handler;
};

/** Per-method route storage: O(1) exact paths plus a list of parametric routes. */
type Bucket = {
  /** Static paths mapped to their (ordered) handler lists. */
  readonly exact: Map<string, Handler[]>;
  /** Parametric routes tried in registration order when no exact path matches. */
  readonly dynamic: DynamicRoute[];
};

/** The result of natively parsing a request body. */
type ParsedBody = {
  /** Parsed body value (object, string, or `undefined`). */
  readonly body: unknown;
  /** Raw body bytes, retained when `{ rawBody: true }` semantics apply. */
  readonly rawBody?: Buffer;
  /** Uploaded files keyed by field name (multipart only). */
  readonly files: Record<string, File>;
};

/** A handler paired with the params extracted from the route that matched it. */
type HandlerEntry = {
  /** The matched route's handler. */
  readonly handler: Handler;
  /** Params bound by this specific route. */
  readonly params: Params;
};

/** The outcome of matching a request: the candidate handler chain and params. */
type Match = {
  /** Candidate handlers, each with its own bound params. */
  readonly handlers: HandlerEntry[];
  /** Params from the first matching route (exposed before dispatch). */
  readonly params: Params;
};

/**
 * Frozen sentinel used ONLY for internal reference-equality checks (e.g.
 * "did this route contribute params yet?"). It must never be handed out as a
 * live per-request value: ESM is strict mode, so middleware/handlers that write
 * to `req.query`/`req.params`/`req.files`/`req.cookies` would throw
 * `TypeError: object is not extensible`. Use {@link emptyRecord} to expose a
 * fresh, mutable `{}` instead.
 */
const EMPTY = Object.freeze({}) as Record<string, never>;

/**
 * Create a fresh, mutable empty record. Use for any field exposed to user code.
 *
 * @returns A new empty object.
 */
function emptyRecord<T>(): Record<string, T> {
  return {};
}

/** HTTP verbs registered by {@link CloudflareAdapter.all}. */
const ALL_VERBS = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
] as const satisfies readonly string[];

/**
 * Whether a route path is parametric (and so must be matched via `URLPattern`)
 * rather than a static path eligible for O(1) exact lookup.
 *
 * @param path The route path to classify.
 * @returns `true` if the path contains a param, wildcard, or group.
 */
function isDynamic(path: string): boolean {
  return path.includes(':') || path.includes('*') || path.includes('(');
}

/**
 * Translate path-to-regexp v8 syntax (the grammar Nest 11 requires and emits)
 * into the Workers `URLPattern` grammar.
 *
 * Nest's `LegacyRouteConverter` produces catch-all routes like `{*path}` /
 * `*path` (bare `*` is rejected in path-to-regexp v8). URLPattern uses a
 * different grammar where a named wildcard is written `:path*`. Without this
 * translation every splat/catch-all route silently 404s because
 * `new URLPattern({pathname:'/{*path}'}).exec({pathname:'/a/b'})` is `null`.
 *
 * - `{*name}` and `*name` -> `:name*` (named wildcard, captured under `name`)
 * - `{ ... }` optional wrappers are unwrapped
 * - bare `*` / `(.*)` -> `*` (URLPattern wildcard, captured under `0`)
 */
function normalizePathPattern(path: string): string {
  return (
    path
      // `{*name}` -> `:name*`
      .replace(/{\*(\w+)}/g, ':$1*')
      // `*name` -> `:name*`
      .replace(/\*(\w+)/g, ':$1*')
      // `(.*)` -> `*`
      .replace(/\(\.\*\)/g, '*')
      // strip any remaining `{ }` wrappers around segments
      .replace(/{([^}]*)}/g, '$1')
  );
}

/**
 * Build a query object from search params, preserving repeated keys as arrays.
 * `?a=1&a=2&b=3` becomes `{ a: ['1', '2'], b: '3' }`.
 */
function parseQuery(
  params: URLSearchParams,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

/**
 * Parse a `Cookie` request header into a name/value record, URL-decoding values.
 *
 * @param header The raw `Cookie` header value, or `null` if absent.
 * @returns A record of cookie names to decoded values.
 */
function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return emptyRecord<string>();
  }
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex <= 0) {
          return null;
        }
        const name = part.slice(0, separatorIndex).trim();
        const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
        return [name, value] as const;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null),
  );
}

/**
 * CloudflareAdapter — a Cloudflare-native Nest HTTP adapter.
 *
 * No Express, no node:http, no port — it routes a Web `Request` straight into
 * Nest's pipeline and returns a Web `Response`. Routing is O(1) for static
 * paths and falls back to `URLPattern` only for parametric routes. Application
 * code stays 100% Nest; everything Cloudflare-shaped is handled here.
 *
 * Because Workers invoke the adapter through a `fetch` export rather than by
 * binding a port, {@link CloudflareAdapter.listen} does not start a server —
 * wire the public {@link CloudflareAdapter.handle} entry point into your
 * Worker's `fetch` export instead:
 *
 * ```ts
 * const app = await NestFactory.create(AppModule, new CloudflareAdapter());
 * await app.init();
 * export default { fetch: (req: Request) => adapter.handle(req) };
 * ```
 *
 * The adapter also mirrors the Express/Fastify compatibility surface of the
 * reference Deno adapter via {@link CloudflareAdapter.useExpressMiddleware},
 * {@link CloudflareAdapter.getExpressApp}, {@link CloudflareAdapter.useFastifyHook}
 * and friends.
 */
export class CloudflareAdapter extends AbstractHttpAdapter<
  CloudflareHttpServer | undefined,
  CloudflareRequest,
  CloudflareResponse
> {
  /** Registered routes, indexed by HTTP method. */
  private readonly buckets = new Map<string, Bucket>();

  /** Registered middleware, each with the path pattern that gates it. */
  private readonly middleware: {
    /** Pattern the request path must match, or `null` to always run. */
    readonly match: URLPatternInstance | null;
    /** The middleware function. */
    readonly fn: Handler;
  }[] = [];

  /** Active CORS configuration, or `null` when CORS is disabled. */
  private cors: CloudflareCorsOptions | null = null;

  /** The lightweight server handle exposed to Nest's lifecycle. */
  private server: CloudflareHttpServer | undefined;

  /** Nest's exception-filter entry point, if registered. */
  private errorHandler:
    | ((error: Error, req: CloudflareRequest, res: CloudflareResponse) => void)
    | undefined;

  /** Custom 404 handler, if registered. */
  private notFoundHandler:
    | ((req: CloudflareRequest, res: CloudflareResponse) => void)
    | undefined;

  /**
   * @param instance Accepted for parity; there is no underlying framework
   *   instance on Workers, so a placeholder object is passed to the base class.
   */
  constructor(instance?: unknown) {
    super(instance ?? {});
  }

  /**
   * Create a new adapter instance.
   *
   * @returns A fresh {@link CloudflareAdapter}.
   */
  public static create(): CloudflareAdapter {
    return new CloudflareAdapter();
  }

  /**
   * Register a `GET` route. Nest calls this during init as `(path, handler)`.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public get(...args: readonly unknown[]): void {
    this.register('GET', args);
  }

  /**
   * Register a `POST` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public post(...args: readonly unknown[]): void {
    this.register('POST', args);
  }

  /**
   * Register a `PUT` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public put(...args: readonly unknown[]): void {
    this.register('PUT', args);
  }

  /**
   * Register a `DELETE` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public delete(...args: readonly unknown[]): void {
    this.register('DELETE', args);
  }

  /**
   * Register a `PATCH` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public patch(...args: readonly unknown[]): void {
    this.register('PATCH', args);
  }

  /**
   * Register an `OPTIONS` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public options(...args: readonly unknown[]): void {
    this.register('OPTIONS', args);
  }

  /**
   * Register a `HEAD` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public head(...args: readonly unknown[]): void {
    this.register('HEAD', args);
  }

  /**
   * Register a `SEARCH` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public search(...args: readonly unknown[]): void {
    this.register('SEARCH', args);
  }

  /**
   * Register a WebDAV `PROPFIND` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public propfind(...args: readonly unknown[]): void {
    this.register('PROPFIND', args);
  }

  /**
   * Register a WebDAV `PROPPATCH` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public proppatch(...args: readonly unknown[]): void {
    this.register('PROPPATCH', args);
  }

  /**
   * Register a WebDAV `MKCOL` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public mkcol(...args: readonly unknown[]): void {
    this.register('MKCOL', args);
  }

  /**
   * Register a WebDAV `COPY` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public copy(...args: readonly unknown[]): void {
    this.register('COPY', args);
  }

  /**
   * Register a WebDAV `MOVE` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public move(...args: readonly unknown[]): void {
    this.register('MOVE', args);
  }

  /**
   * Register a WebDAV `LOCK` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public lock(...args: readonly unknown[]): void {
    this.register('LOCK', args);
  }

  /**
   * Register a WebDAV `UNLOCK` route.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public unlock(...args: readonly unknown[]): void {
    this.register('UNLOCK', args);
  }

  /**
   * Register the same handler under every supported HTTP verb.
   *
   * @param args The `(path, handler)` pair Nest supplies.
   */
  public all(...args: readonly unknown[]): void {
    ALL_VERBS.forEach((verb) => this.register(verb, args));
  }

  /**
   * Mount global or path-scoped middleware (backs Nest's `app.use()`).
   *
   * @param args Either `(middleware)` or `(path, middleware)`; non-function
   *   middleware are ignored.
   */
  public use(...args: readonly unknown[]): void {
    const hasPath = args.length >= 2;
    const fn = (hasPath ? args[1] : args[0]) as Handler;
    if (typeof fn !== 'function') {
      return;
    }
    const path = hasPath ? (args[0] as string) : null;
    this.middleware.push({
      match: CloudflareAdapter.middlewarePattern(path),
      fn,
    });
  }

  /**
   * The adapter's entry point: route a native Web `Request` through CORS,
   * middleware, the matched handler chain and any error/not-found handlers,
   * then serialize the buffered result into a native Web `Response`. Wire this
   * into a Worker's `fetch` export.
   *
   * @param request The incoming Web `Request`.
   * @returns The Web `Response` to return from the Worker.
   */
  public async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (
      this.cors &&
      request.method === 'OPTIONS' &&
      request.headers.get('access-control-request-method') !== null
    ) {
      return this.preflight(request);
    }

    const match = this.matchRoute(request.method, url);
    if (!match && this.middleware.length === 0 && !this.cors) {
      return this.notFound(request, url);
    }

    const req = await this.buildRequest(request, url, match?.params ?? EMPTY);
    const res = CloudflareAdapter.buildResponse();

    try {
      if (this.middleware.length > 0) {
        await this.runMiddleware(req, res, url);
        if (res.sent) {
          this.applyCors(req, res);
          return CloudflareAdapter.toResponse(res, request.method);
        }
      }
      this.applyCors(req, res);

      if (!match) {
        return this.notFound(request, url, res);
      }

      const handled = await this.dispatchHandlers(req, res, match.handlers);
      if (!handled) {
        return this.notFound(request, url, res);
      }
      // NOTE: the adapter buffers the response and awaits it settling, so
      // handlers that never settle (e.g. @Sse() streams or @Res() handlers that
      // never call send/end) are not supported — see README "Known Issues".
      if (!res.sent) {
        await res.settled;
      }
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler(error as Error, req, res);
        // An async exception filter (e.g. one that awaits a logger before
        // replying) writes the response on a later tick. Await settling so the
        // intended error body is produced before we serialize `res`, mirroring
        // the success path at lines above.
        if (!res.sent) {
          await res.settled;
        }
      } else if (!res.sent) {
        res.statusCode = 500;
        res.body = 'Internal Server Error';
      }
    }
    return CloudflareAdapter.toResponse(res, request.method);
  }

  /**
   * Use Express middleware with the Cloudflare adapter.
   *
   * Wraps Express middleware so it runs against the adapter's request/response
   * objects, letting you reuse existing Express middleware packages such as
   * `helmet()` or `cookie-parser`.
   *
   * @example
   * ```ts
   * import helmet from 'helmet';
   * const adapter = new CloudflareAdapter();
   * adapter.useExpressMiddleware(helmet());
   * adapter.useExpressMiddleware('/api', compression());
   * ```
   */
  public useExpressMiddleware(
    middleware: ExpressMiddleware | ExpressErrorMiddleware,
  ): void;
  public useExpressMiddleware(
    path: string,
    middleware: ExpressMiddleware | ExpressErrorMiddleware,
  ): void;
  public useExpressMiddleware(
    pathOrMiddleware: string | ExpressMiddleware | ExpressErrorMiddleware,
    middleware?: ExpressMiddleware | ExpressErrorMiddleware,
  ): void {
    if (typeof pathOrMiddleware === 'function') {
      this.use(wrapExpressMiddleware(pathOrMiddleware));
    } else if (middleware) {
      this.use(pathOrMiddleware, wrapExpressMiddleware(middleware));
    }
  }

  /**
   * Create an Express-like app instance for middleware that expects `app.use()`.
   *
   * Some Express middleware require an Express app instance; this returns a
   * compatible shim that routes registrations through the adapter.
   *
   * @example
   * ```ts
   * const adapter = new CloudflareAdapter();
   * const expressApp = adapter.getExpressApp();
   * expressApp.use(session({ secret: 'keyboard cat' }));
   * ```
   */
  public getExpressApp(): ExpressLikeApp {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const settings: Record<string, unknown> = {};

    const registerRoute = (
      method: (path: string, handler: Handler) => void,
      path: string,
      handlers: ExpressMiddleware[],
    ): void => {
      handlers.forEach((handler) => {
        method.call(self, path, async (req, res) => {
          await handler(
            createExpressRequest(req),
            createExpressResponse(res),
            () => {},
          );
        });
      });
    };

    const app: ExpressLikeApp = {
      locals: {},
      settings,

      use(...args: unknown[]) {
        if (args.length === 1 && typeof args[0] === 'function') {
          self.useExpressMiddleware(args[0] as ExpressMiddleware);
        } else if (
          args.length === 2 &&
          typeof args[0] === 'string' &&
          typeof args[1] === 'function'
        ) {
          self.useExpressMiddleware(args[0], args[1] as ExpressMiddleware);
        } else if (args.length >= 2) {
          const path = typeof args[0] === 'string' ? args[0] : '*';
          const handlers = typeof args[0] === 'string' ? args.slice(1) : args;
          handlers.forEach((handler) => {
            if (typeof handler === 'function') {
              self.useExpressMiddleware(path, handler as ExpressMiddleware);
            }
          });
        }
      },

      get: (path, ...handlers) => registerRoute(self.get, path, handlers),
      post: (path, ...handlers) => registerRoute(self.post, path, handlers),
      put: (path, ...handlers) => registerRoute(self.put, path, handlers),
      delete: (path, ...handlers) => registerRoute(self.delete, path, handlers),
      patch: (path, ...handlers) => registerRoute(self.patch, path, handlers),
      options: (path, ...handlers) =>
        registerRoute(self.options, path, handlers),
      head: (path, ...handlers) => registerRoute(self.head, path, handlers),
      all: (path, ...handlers) => registerRoute(self.all, path, handlers),

      set(key, value) {
        settings[key] = value;
      },
      enable(key) {
        settings[key] = true;
      },
      disable(key) {
        settings[key] = false;
      },
      enabled(key) {
        return Boolean(settings[key]);
      },
      disabled(key) {
        return !settings[key];
      },
    };

    return app;
  }

  /**
   * Register a Fastify plugin with the Cloudflare adapter.
   *
   * @example
   * ```ts
   * await adapter.registerFastifyPlugin(myPlugin, { option: true });
   * ```
   */
  public async registerFastifyPlugin<Options = Record<string, unknown>>(
    plugin: FastifyPlugin<Options> | FastifyPluginAsync<Options>,
    opts?: Options,
  ): Promise<void> {
    const instance = this.getFastifyInstance();
    await wrapFastifyPlugin(plugin, instance, opts);
  }

  /**
   * Use a Fastify hook with the Cloudflare adapter.
   *
   * Wraps a Fastify-style hook so it runs in the adapter's middleware chain.
   *
   * @example
   * ```ts
   * adapter.useFastifyHook('onRequest', async (request, reply) => {
   *   console.log('Request received:', request.url);
   * });
   * ```
   */
  public useFastifyHook(_name: FastifyHookName, hook: FastifyHook): void {
    // The hook name is accepted for parity; all hooks run in the chain.
    this.use(wrapFastifyHook(hook));
  }

  /**
   * Get a Fastify-like instance for plugins/hooks that require it.
   *
   * @example
   * ```ts
   * const fastify = adapter.getFastifyInstance();
   * fastify.addHook('onRequest', async (request, reply) => { ... });
   * ```
   */
  public getFastifyInstance(): FastifyLikeInstance {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const decorators: Record<string, unknown> = {};
    const requestDecorators: Record<string, unknown> = {};
    const replyDecorators: Record<string, unknown> = {};

    const instance: FastifyLikeInstance = {
      log: createFastifyLogger(),
      prefix: '',

      decorate(name, value) {
        decorators[name] = value;
        return this;
      },
      decorateRequest(name, value) {
        requestDecorators[name] = value;
        return this;
      },
      decorateReply(name, value) {
        replyDecorators[name] = value;
        return this;
      },
      hasDecorator(name) {
        return name in decorators;
      },
      hasRequestDecorator(name) {
        return name in requestDecorators;
      },
      hasReplyDecorator(name) {
        return name in replyDecorators;
      },

      addHook(
        name: FastifyHookName,
        hook: FastifyHook | FastifyErrorHook | FastifyOnSendHook,
      ) {
        if (
          ['onRequest', 'preParsing', 'preValidation', 'preHandler'].includes(
            name,
          )
        ) {
          self.useFastifyHook(name, hook as FastifyHook);
        }
        return this;
      },

      register<Options = Record<string, unknown>>(
        plugin: FastifyPlugin<Options> | FastifyPluginAsync<Options>,
        opts?: Options,
      ) {
        wrapFastifyPlugin(plugin, this, opts).catch((error) =>
          this.log.error(String(error)),
        );
        return this;
      },

      route(opts: FastifyRouteOptions) {
        const methods = Array.isArray(opts.method)
          ? opts.method
          : [opts.method];

        methods.forEach((method) => {
          const handler: Handler = async (req, res) => {
            const fastifyReq = createFastifyRequest(req);
            const fastifyReply = createFastifyReply(res);

            Object.entries(requestDecorators).forEach(([key, value]) => {
              fastifyReq[key] = typeof value === 'function' ? value() : value;
            });
            Object.entries(replyDecorators).forEach(([key, value]) => {
              fastifyReply[key] = typeof value === 'function' ? value() : value;
            });

            const hooks = [
              ...(opts.onRequest
                ? Array.isArray(opts.onRequest)
                  ? opts.onRequest
                  : [opts.onRequest]
                : []),
              ...(opts.preValidation
                ? Array.isArray(opts.preValidation)
                  ? opts.preValidation
                  : [opts.preValidation]
                : []),
              ...(opts.preHandler
                ? Array.isArray(opts.preHandler)
                  ? opts.preHandler
                  : [opts.preHandler]
                : []),
            ];

            for (const hook of hooks) {
              if (fastifyReply.sent) {
                break;
              }
              await new Promise<void>((resolve, reject) => {
                if (hook.length <= 2) {
                  (hook as (req: unknown, rep: unknown) => Promise<void>)(
                    fastifyReq,
                    fastifyReply,
                  )
                    .then(resolve)
                    .catch(reject);
                } else {
                  (
                    hook as (
                      req: unknown,
                      rep: unknown,
                      done: (err?: Error) => void,
                    ) => void
                  )(fastifyReq, fastifyReply, (err?: Error) =>
                    err ? reject(err) : resolve(),
                  );
                }
              });
            }

            if (!fastifyReply.sent) {
              const result = await opts.handler(fastifyReq, fastifyReply);
              if (result !== undefined && !fastifyReply.sent) {
                fastifyReply.send(result);
              }
            }
          };

          switch (method.toUpperCase()) {
            case 'GET':
              self.get(opts.url, handler);
              break;
            case 'POST':
              self.post(opts.url, handler);
              break;
            case 'PUT':
              self.put(opts.url, handler);
              break;
            case 'DELETE':
              self.delete(opts.url, handler);
              break;
            case 'PATCH':
              self.patch(opts.url, handler);
              break;
            case 'OPTIONS':
              self.options(opts.url, handler);
              break;
            case 'HEAD':
              self.head(opts.url, handler);
              break;
            default:
              self.all(opts.url, handler);
          }
        });

        return this;
      },

      get(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'GET', url: path, handler: h });
      },
      post(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'POST', url: path, handler: h });
      },
      put(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'PUT', url: path, handler: h });
      },
      delete(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'DELETE', url: path, handler: h });
      },
      patch(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'PATCH', url: path, handler: h });
      },
      options(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({
          ...opts,
          method: 'OPTIONS',
          url: path,
          handler: h,
        });
      },
      head(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({ ...opts, method: 'HEAD', url: path, handler: h });
      },
      all(path, optsOrHandler?, handler?) {
        const h = (
          typeof optsOrHandler === 'function' ? optsOrHandler : handler!
        ) as FastifyRouteHandler;
        const opts = typeof optsOrHandler === 'object' ? optsOrHandler : {};
        return this.route({
          ...opts,
          method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
          url: path,
          handler: h,
        });
      },
    };

    return instance;
  }

  /**
   * Write a body onto the response (Nest's primary reply path), inferring the
   * `Content-Type` from the body's kind, then settle the response.
   *
   * @param res The adapter response.
   * @param body The body to send.
   * @param statusCode Optional status code to set.
   */
  public reply(
    res: CloudflareResponse,
    body: unknown,
    statusCode?: number,
  ): void {
    if (statusCode) {
      res.statusCode = statusCode;
    }
    if (body === undefined || body === null) {
      res.body = null;
    } else if (typeof body === 'string') {
      res.body = body;
      if (!res.headers.has('content-type')) {
        res.headers.set('content-type', 'text/plain; charset=utf-8');
      }
    } else if (
      body instanceof Uint8Array ||
      body instanceof ArrayBuffer ||
      body instanceof ReadableStream
    ) {
      // eslint-disable-next-line no-undef
      res.body = body as BodyInit;
    } else {
      res.body = JSON.stringify(body);
      if (!res.headers.has('content-type')) {
        res.headers.set('content-type', 'application/json; charset=utf-8');
      }
    }
    res.sent = true;
    res.headersSent = true;
    res.settle();
  }

  /**
   * Set the response status code.
   *
   * @param res The adapter response.
   * @param statusCode HTTP status code.
   * @returns The same response, for chaining.
   */
  public status(
    res: CloudflareResponse,
    statusCode: number,
  ): CloudflareResponse {
    res.statusCode = statusCode;
    return res;
  }

  /**
   * Buffer a redirect response and settle it.
   *
   * @param res The adapter response.
   * @param statusCode Redirect status code (defaults to 302 when falsy).
   * @param url Target location.
   */
  public redirect(
    res: CloudflareResponse,
    statusCode: number,
    url: string,
  ): void {
    res.statusCode = statusCode || 302;
    res.headers.set('location', url);
    res.sent = true;
    res.headersSent = true;
    res.settle();
  }

  /**
   * End the response, optionally with a final message.
   *
   * @param res The adapter response.
   * @param message Optional final body.
   */
  public end(res: CloudflareResponse, message?: string): void {
    res.end(message);
  }

  /**
   * Set a response header, replacing any existing value.
   *
   * @param res The adapter response.
   * @param name Header name.
   * @param value Header value.
   */
  public setHeader(res: CloudflareResponse, name: string, value: string): void {
    res.headers.set(name, String(value));
  }

  /**
   * Read a response header value.
   *
   * @param res The adapter response.
   * @param name Header name.
   * @returns The header value, or `null` if absent.
   */
  public getHeader(res: CloudflareResponse, name: string): string | null {
    return res.headers.get(name);
  }

  /**
   * Append a value to a response header without replacing existing values.
   *
   * @param res The adapter response.
   * @param name Header name.
   * @param value Header value to append.
   */
  public appendHeader(
    res: CloudflareResponse,
    name: string,
    value: string,
  ): void {
    res.headers.append(name, String(value));
  }

  /**
   * Whether the response has already been sent.
   *
   * @param res The adapter response.
   * @returns `true` once a body has been produced.
   */
  public isHeadersSent(res: CloudflareResponse): boolean {
    return res.sent;
  }

  /**
   * Read the request's HTTP method.
   *
   * @param req The adapter request.
   * @returns The HTTP method.
   */
  public getRequestMethod(req: CloudflareRequest): string {
    return req.method;
  }

  /**
   * Read the request URL (path plus query string).
   *
   * @param req The adapter request.
   * @returns The request URL.
   */
  public getRequestUrl(req: CloudflareRequest): string {
    return req.url;
  }

  /**
   * Read the request host name, falling back to the `Host` header.
   *
   * @param req The adapter request.
   * @returns The host name, or an empty string if unknown.
   */
  public getRequestHostname(req: CloudflareRequest): string {
    return req.hostname ?? req.headers.get('host') ?? '';
  }

  /**
   * Initialise the lightweight server handle Nest holds for its lifecycle.
   * There is no socket on Workers; the handle simply delegates to
   * {@link handle}.
   */
  public initHttpServer(): void {
    this.server = {
      handle: (request) => this.handle(request),
      finished: Promise.resolve(),
    };
    this.httpServer = this.server as never;
  }

  /**
   * On Cloudflare Workers there is no port to bind. {@link listen} therefore
   * does NOT start a server — the Worker runtime invokes the adapter through a
   * `fetch` export instead. It simply records that it was called and fires the
   * optional callback so Nest's bootstrap completes.
   */
  public listen(_port: unknown, ...args: readonly unknown[]): unknown {
    const callback = args.find((arg) => typeof arg === 'function') as
      | (() => void)
      | undefined;
    callback?.();
    return this.httpServer;
  }

  /**
   * Get the server handle.
   *
   * @returns The server handle, or `undefined` before init.
   */
  public getHttpServer(): CloudflareHttpServer | undefined {
    return this.server;
  }

  /**
   * Replace the server handle.
   *
   * @param server The handle to use.
   */
  public setHttpServer(server: CloudflareHttpServer): void {
    this.server = server;
    this.httpServer = server as never;
  }

  /**
   * Tear down the adapter. A no-op on Workers, as there is nothing to close.
   *
   * @returns An already-resolved promise.
   */
  public close(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * No-op: request bodies are parsed natively in {@link handle}, so there is no
   * separate body-parser middleware to register.
   */
  public registerParserMiddleware(): void {
    // body is parsed natively in handle()
  }

  /**
   * Provide the factory Nest uses to register route-scoped middleware. The
   * returned `(path, callback)` registrar records each middleware against a
   * path matcher; the chain runs in {@link handle} before routing.
   *
   * @param _method The HTTP method the middleware is scoped to (unused — the
   *   adapter matches middleware purely on path).
   * @returns A registrar that adds a middleware for the given path.
   */
  public createMiddlewareFactory(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _method: RequestMethod,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ): (path: string, callback: Function) => void {
    return (path, callback) => {
      this.middleware.push({
        match: CloudflareAdapter.middlewarePattern(path),
        fn: callback as Handler,
      });
    };
  }

  /**
   * Enable CORS handling for the application. Preflight `OPTIONS` requests are
   * answered automatically and the configured headers are applied to matching
   * responses.
   *
   * @param options CORS configuration; a permissive default is used when
   *   omitted.
   */
  public enableCors(options?: CloudflareCorsOptions): void {
    this.cors = options ?? {};
  }

  /**
   * Wrap a route handler with API-version matching. The returned handler runs
   * the wrapped handler when the request's resolved version matches `version`,
   * otherwise calls `next()` to fall through to the next versioned handler
   * registered on the same route.
   *
   * @param handler The route handler to guard.
   * @param version The version(s) this handler serves — a string, an array, or
   *   `VERSION_NEUTRAL`.
   * @param versioningOptions The active versioning strategy.
   * @returns A version-aware handler suitable for the route chain.
   */
  public applyVersionFilter(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ): (req: CloudflareRequest, res: CloudflareResponse, next: Next) => Function {
    const run = handler as Handler;
    return (req, res, next) => {
      const requested = CloudflareAdapter.resolveRequestedVersion(
        req,
        versioningOptions,
      );
      if (
        CloudflareAdapter.versionMatches(version, requested, versioningOptions)
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        return run(req, res, next) as Function;
      }
      next();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      return (() => undefined) as Function;
    };
  }

  /**
   * No-op on Cloudflare Workers. Static files are served by the platform's
   * `assets` binding configured in `wrangler.toml`, not by the adapter. The
   * method and its options type are kept for parity with other adapters.
   */
  public useStaticAssets(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _path?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: CloudflareStaticAssetsOptions,
  ): void {
    // static files are served by the Workers `assets` binding
  }

  /**
   * No-op on Cloudflare Workers — there is no server-side view engine. Return
   * strings or `Response` objects from controllers instead.
   */
  public setViewEngine(): void {}

  /**
   * Unsupported on Cloudflare Workers. Server-side template rendering has no
   * platform equivalent; controllers should return strings or `Response`
   * objects rather than render a view.
   *
   * @throws Always — view rendering is not supported.
   */
  public render(): never {
    throw new Error('CloudflareAdapter: view rendering is not supported');
  }

  /**
   * Register a custom handler invoked when a request throws and no Nest
   * exception filter has already produced a response.
   *
   * @param handler Receives the thrown error and the request/response pair.
   */
  public setErrorHandler(
    handler: (
      error: Error,
      req: CloudflareRequest,
      res: CloudflareResponse,
    ) => void,
  ): void {
    this.errorHandler = handler;
  }

  /**
   * Register a custom handler invoked when no registered route matches a
   * request, in place of the default JSON 404.
   *
   * @param handler Receives the request/response pair.
   */
  public setNotFoundHandler(
    handler: (req: CloudflareRequest, res: CloudflareResponse) => void,
  ): void {
    this.notFoundHandler = handler;
  }

  /**
   * Identify this adapter to Nest core.
   *
   * @returns The adapter type tag, `'fetch'`.
   */
  public getType(): string {
    return 'fetch';
  }

  /**
   * Get the route bucket for a method, creating it on first use.
   *
   * @param method HTTP method.
   * @returns The bucket holding that method's routes.
   */
  private bucketFor(method: string): Bucket {
    const existing = this.buckets.get(method);
    if (existing) {
      return existing;
    }
    const created: Bucket = { exact: new Map(), dynamic: [] };
    this.buckets.set(method, created);
    return created;
  }

  /**
   * Register a handler for a method/path, routing it to the exact-path map or
   * the parametric list depending on whether the path is dynamic.
   *
   * Nest's `AbstractHttpAdapter` types every verb as `(...args)`, so the
   * `(path, handler)` pair is narrowed here once rather than at each call site.
   *
   * @param method HTTP method.
   * @param args The `(path, handler)` pair Nest supplies.
   */
  private register(method: string, args: readonly unknown[]): void {
    const path = args[0] as string;
    const handler = args[1] as Handler;
    const bucket = this.bucketFor(method);
    if (isDynamic(path)) {
      bucket.dynamic.push({
        pattern: new URLPattern({ pathname: normalizePathPattern(path) }),
        handler,
      });
    } else {
      const existing = bucket.exact.get(path);
      if (existing) {
        existing.push(handler);
      } else {
        bucket.exact.set(path, [handler]);
      }
    }
  }

  /**
   * Run a chain of handlers (a versioned route's candidate list) as a
   * next-chain: each handler receives a `next` that advances to the following
   * one. The first handler that ends the response wins; if every handler calls
   * `next` without responding, the chain is exhausted and the caller treats it
   * as unmatched. A non-versioned route is a single-element chain and behaves
   * exactly as a lone handler would.
   *
   * Resolves `true` when a handler produced (or is producing) a response,
   * `false` when the chain fell through without anyone responding.
   */
  private async dispatchHandlers(
    req: CloudflareRequest,
    res: BufferedResponse,
    handlers: HandlerEntry[],
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const dispatch = (index: number): void => {
        if (res.sent) {
          resolve(true);
          return;
        }
        if (index >= handlers.length) {
          resolve(false);
          return;
        }
        let advanced = false;
        const next: Next = (err) => {
          if (advanced) {
            return;
          }
          advanced = true;
          if (err) {
            reject(err);
          } else {
            dispatch(index + 1);
          }
        };
        // Once a handler returns without calling next(), it has "won" the
        // chain. It may have responded synchronously (res.sent), or it may be a
        // deferred-settle handler (@Res()/streaming) that produces its response
        // asynchronously after its returned promise resolves. In that case we
        // must await res.settled — exactly as the non-versioned path did — so
        // the dispatch promise settles and the request never hangs.
        const settle = (): void => {
          if (advanced) {
            return;
          }
          if (res.sent) {
            resolve(true);
          } else {
            res.settled.then(() => resolve(true)).catch(reject);
          }
        };
        // Rebind req.params to THIS handler's params before invoking it, so a
        // later, differently-parameterized route in the same fall-through chain
        // sees its own param names rather than the first match's.
        const entry = handlers[index];
        req.params = entry.params === EMPTY ? emptyRecord() : entry.params;
        try {
          const result = entry.handler(req, res, next);
          if (result instanceof Promise) {
            result.then(settle).catch(reject);
          } else {
            settle();
          }
        } catch (error) {
          reject(error);
        }
      };
      dispatch(0);
    });
  }

  /**
   * Match a request to its candidate handler chain, falling back from `HEAD`
   * to the `GET` routes (HEAD requests are served by GET handlers).
   *
   * @param method The request's HTTP method.
   * @param url The parsed request URL.
   * @returns The match, or `null` when no route matches.
   */
  private matchRoute(method: string, url: URL): Match | null {
    const direct = this.matchInBucket(method, url);
    if (direct) {
      return direct;
    }
    if (method === 'HEAD') {
      return this.matchInBucket('GET', url);
    }
    return null;
  }

  /**
   * Match a URL within a single method's bucket: an O(1) exact-path lookup
   * first, then the parametric routes in registration order.
   *
   * @param method HTTP method whose bucket to search.
   * @param url The parsed request URL.
   * @returns The match, or `null` when nothing in the bucket matches.
   */
  private matchInBucket(method: string, url: URL): Match | null {
    const bucket = this.buckets.get(method);
    if (!bucket) {
      return null;
    }
    const exact = bucket.exact.get(url.pathname);
    if (exact) {
      return {
        handlers: exact.map((handler) => ({ handler, params: EMPTY })),
        params: EMPTY,
      };
    }
    const handlers: HandlerEntry[] = [];
    let firstParams: Params = EMPTY;
    for (const route of bucket.dynamic) {
      const matched = route.pattern.exec(url);
      if (matched) {
        // Each matched route carries ITS OWN params. Two distinct patterns
        // (e.g. `/users/:id` and `/users/:name`) can both match the same path
        // but bind different param names; sharing one params object across the
        // merged chain would feed later handlers the first route's params.
        let params: Params = EMPTY;
        if (matched.pathname.groups) {
          // Drop unmatched optional groups (present as `undefined` on the
          // native runtime) so the exposed record stays truthful.
          params = Object.fromEntries(
            Object.entries(matched.pathname.groups).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          );
        }
        handlers.push({ handler: route.handler, params });
        if (firstParams === EMPTY) {
          firstParams = params;
        }
      }
    }
    return handlers.length > 0 ? { handlers, params: firstParams } : null;
  }

  /**
   * Build the adapter's {@link CloudflareRequest} from a native request,
   * parsing the body, query and cookies and exposing mutable param/query
   * records (never the frozen sentinel).
   *
   * @param request The native Web `Request`.
   * @param url The parsed request URL.
   * @param params Params from the matched route.
   * @returns The constructed adapter request.
   */
  private async buildRequest(
    request: Request,
    url: URL,
    params: Params,
  ): Promise<CloudflareRequest> {
    const parsed = await this.parseBody(request);
    return {
      raw: request,
      method: request.method,
      url: url.pathname + url.search,
      originalUrl: url.pathname + url.search,
      path: url.pathname,
      baseUrl: '',
      protocol: 'https',
      secure: true,
      ip: request.headers.get('cf-connecting-ip') ?? '',
      hostname: url.hostname,
      headers: request.headers,
      query: url.search ? parseQuery(url.searchParams) : emptyRecord(),
      // Never expose the frozen sentinel — middleware may write to req.params.
      params: params === EMPTY ? emptyRecord() : params,
      cookies: parseCookies(request.headers.get('cookie')),
      body: parsed.body,
      rawBody: parsed.rawBody,
      files: parsed.files,
      get: (name) => request.headers.get(name),
    };
  }

  /**
   * Natively parse a request body by content type — multipart form data, JSON,
   * URL-encoded form, or raw text — reading the underlying bytes exactly once.
   *
   * @param request The native Web `Request`.
   * @returns The parsed body, raw bytes (where applicable) and any files.
   */
  private async parseBody(request: Request): Promise<ParsedBody> {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return { body: undefined, files: emptyRecord<File>() };
    }

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // `request.formData()` rejects on a malformed/truncated body or a missing
      // boundary. This runs OUTSIDE handle()'s try/catch, so a throw here would
      // escape as an unhandled rejection and bypass the controlled error path.
      // Treat an unparseable multipart body as empty rather than crashing.
      try {
        const form = await request.formData();
        const fields: Record<string, unknown> = {};
        const files: Record<string, File> = {};
        for (const [key, value] of form) {
          if (value instanceof File) {
            files[key] = value;
          } else {
            fields[key] = value;
          }
        }
        return { body: fields, files };
      } catch {
        return { body: {}, files: emptyRecord<File>() };
      }
    }

    const buffer = await request.arrayBuffer(); // single read of the exact bytes
    if (buffer.byteLength === 0) {
      return { body: {}, files: emptyRecord<File>() };
    }

    const rawBody = Buffer.from(buffer); // honors `{ rawBody: true }`
    const text = new TextDecoder().decode(buffer);

    if (contentType.includes('application/json')) {
      try {
        return { body: JSON.parse(text), rawBody, files: emptyRecord<File>() };
      } catch {
        return { body: text, rawBody, files: emptyRecord<File>() };
      }
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return {
        body: Object.fromEntries(new URLSearchParams(text)),
        rawBody,
        files: emptyRecord<File>(),
      };
    }
    return { body: text, rawBody, files: emptyRecord<File>() };
  }

  /**
   * Construct a fresh buffered {@link CloudflareResponse}, including the
   * internal `settled` promise that {@link handle} awaits for deferred-settle
   * handlers (e.g. `@Res()` controllers).
   *
   * @returns The response object plus its `settled` promise.
   */
  private static buildResponse(): BufferedResponse {
    const { promise, resolve } = Promise.withResolvers<void>();
    const headers = new Headers();
    const res: CloudflareResponse & { settled: Promise<void> } = {
      statusCode: 200,
      headersSent: false,
      body: null,
      sent: false,
      headers,
      settled: promise,
      settle: resolve,
      status(code) {
        res.statusCode = code;
        return res;
      },
      setHeader(name, value) {
        headers.set(name, String(value));
        return res;
      },
      getHeader(name) {
        return headers.get(name);
      },
      getSetCookie() {
        const nativeHeaders = headers as Headers & {
          getSetCookie?: () => string[];
        };
        if (typeof nativeHeaders.getSetCookie === 'function') {
          return nativeHeaders.getSetCookie();
        }
        const rawSetCookie = headers.get('set-cookie');
        return rawSetCookie ? [rawSetCookie] : [];
      },
      removeHeader(name) {
        headers.delete(name);
        return res;
      },
      send(body) {
        res.headersSent = true;
        res.sent = true;
        if (body === undefined || body === null) {
          res.body = null;
        } else if (
          typeof body === 'object' &&
          !(body instanceof Blob) &&
          !(body instanceof ReadableStream) &&
          !(body instanceof FormData) &&
          !(body instanceof URLSearchParams) &&
          !(body instanceof ArrayBuffer) &&
          !(body instanceof Uint8Array)
        ) {
          if (!headers.has('content-type')) {
            headers.set('content-type', 'application/json; charset=utf-8');
          }
          res.body = JSON.stringify(body);
        } else {
          // eslint-disable-next-line no-undef
          res.body = body as BodyInit;
        }
        resolve();
      },
      json(body) {
        res.headersSent = true;
        res.sent = true;
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json; charset=utf-8');
        }
        res.body = JSON.stringify(body);
        resolve();
      },
      redirect(url, code = 302) {
        res.headersSent = true;
        res.sent = true;
        res.statusCode = code;
        headers.set('location', url);
        res.body = null;
        resolve();
      },
      end(message) {
        res.body = message ?? null;
        res.sent = true;
        res.headersSent = true;
        resolve();
      },
    };
    return res;
  }

  /**
   * Run the middleware whose pattern matches the request path as an
   * error-aware connect chain: a `next(err)` skips forward to the next 4-arg
   * error handler, and the chain ends early once a middleware responds.
   *
   * @param req The adapter request.
   * @param res The adapter response.
   * @param url The parsed request URL used to select matching middleware.
   * @returns A promise that resolves when the chain settles, or rejects with an
   *   unhandled error.
   */
  private runMiddleware(
    req: CloudflareRequest,
    res: CloudflareResponse,
    url: URL,
  ): Promise<void> {
    const chain = this.middleware.filter(
      (entry) => entry.match === null || entry.match.test(url),
    );
    return new Promise((resolve, reject) => {
      // The chain is error-aware: when a middleware calls next(err), we advance
      // carrying that error and skip forward to the next 4-arg Express error
      // handler, invoking it with the error. Only when no error handler remains
      // do we reject the outer promise (the generic catch-all 500).
      const dispatch = (index: number, err?: unknown): void => {
        if (res.sent) {
          resolve();
          return;
        }
        if (index >= chain.length) {
          // Chain exhausted: if an unhandled error is still in flight, surface
          // it; otherwise the chain simply fell through to routing.
          if (err !== undefined) {
            reject(err);
          } else {
            resolve();
          }
          return;
        }
        const entry = chain[index];
        const isErrorHandler =
          (entry.fn as { isExpressErrorMiddleware?: boolean })
            .isExpressErrorMiddleware === true;
        // While an error is in flight, run only error handlers; with no error,
        // run only normal middleware. Skip the rest without invoking them.
        if (err !== undefined && !isErrorHandler) {
          dispatch(index + 1, err);
          return;
        }
        if (err === undefined && isErrorHandler) {
          dispatch(index + 1);
          return;
        }
        let advanced = false;
        const next: Next = (nextErr) => {
          if (advanced) {
            return;
          }
          advanced = true;
          // If an error handler advances without a new error, the error is
          // considered handled; carry forward `nextErr` otherwise.
          dispatch(index + 1, nextErr);
        };
        try {
          const result = (
            entry.fn as (
              req: CloudflareRequest,
              res: CloudflareResponse,
              next: Next,
              err?: unknown,
            ) => unknown
          )(req, res, next, err);
          if (result instanceof Promise) {
            result
              .then(() => {
                // A middleware that responded without calling next() (e.g. a
                // guard, or an error handler that sent a response) ends here.
                if (res.sent && !advanced) {
                  resolve();
                }
              })
              .catch(reject);
          } else if (res.sent && !advanced) {
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };
      dispatch(0);
    });
  }

  /**
   * Build the response to a CORS preflight (`OPTIONS`) request, stamping the
   * allow-origin/methods/headers/credentials and appropriate `Vary` headers.
   *
   * @param request The preflight request.
   * @returns The preflight `Response`.
   */
  private preflight(request: Request): Response {
    const headers = new Headers();
    const cors = this.cors!;
    const allowOrigin = CloudflareAdapter.allowOrigin(cors, request);
    if (allowOrigin) {
      headers.set('access-control-allow-origin', allowOrigin);
    }
    // When the allow-origin is reflected (anything other than `*`), shared
    // caches must vary on the request to avoid cross-serving one origin's
    // ACAO header to another. Mirrors Nest's `cors` middleware on preflight.
    if (allowOrigin && allowOrigin !== '*') {
      headers.append('vary', 'Origin');
    }
    headers.append('vary', 'Access-Control-Request-Headers');
    if (cors.credentials) {
      headers.set('access-control-allow-credentials', 'true');
    }

    const allowMethods = (() => {
      if (Array.isArray(cors.methods)) {
        return cors.methods.join(',');
      }
      return cors.methods ?? 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
    })();
    headers.set('access-control-allow-methods', allowMethods);

    const allowHeaders = (() => {
      if (Array.isArray(cors.allowedHeaders)) {
        return cors.allowedHeaders.join(',');
      }
      return (
        cors.allowedHeaders ??
        request.headers.get('access-control-request-headers') ??
        '*'
      );
    })();
    headers.set('access-control-allow-headers', allowHeaders);

    if (cors.maxAge) {
      headers.set('access-control-max-age', String(cors.maxAge));
    }
    return new Response(null, {
      status: cors.optionsSuccessStatus ?? 204,
      headers,
    });
  }

  /**
   * Stamp CORS response headers (allow-origin, `Vary`, credentials, exposed
   * headers) onto the buffered response for non-preflight requests.
   *
   * @param req The adapter request (used to read the request origin).
   * @param res The adapter response to write headers onto.
   */
  private applyCors(req: CloudflareRequest, res: CloudflareResponse): void {
    if (!this.cors) {
      return;
    }
    const cors = this.cors;
    const allowOrigin = CloudflareAdapter.allowOrigin(cors, req.raw);
    if (allowOrigin) {
      res.setHeader('access-control-allow-origin', allowOrigin);
    }
    // A reflected (non-`*`) origin must set `Vary: Origin` so CDN/shared caches
    // don't serve one origin's allow-origin header to a different origin.
    if (allowOrigin && allowOrigin !== '*') {
      res.headers.append('vary', 'Origin');
    }
    if (cors.credentials) {
      res.setHeader('access-control-allow-credentials', 'true');
    }
    if (cors.exposedHeaders) {
      const exposed = Array.isArray(cors.exposedHeaders)
        ? cors.exposedHeaders.join(',')
        : cors.exposedHeaders;
      res.setHeader('access-control-expose-headers', exposed);
    }
  }

  /**
   * Build the 404 response.
   *
   * `corsRes` is the buffered response that {@link handle} already ran
   * {@link applyCors} against; its headers (Access-Control-Allow-Origin, Vary,
   * etc.) are carried onto the 404 so a cross-origin request to an unknown route
   * comes back as a clean 404 WITH CORS headers rather than an opaque CORS
   * failure — matching Express's `cors` middleware, which stamps ACAO before
   * routing.
   *
   * @param request The unmatched request.
   * @param url The parsed request URL.
   * @param corsRes The CORS-stamped buffered response whose headers to carry.
   * @returns The 404 `Response`.
   */
  private notFound(
    request: Request,
    url: URL,
    corsRes?: CloudflareResponse,
  ): Response {
    if (this.notFoundHandler) {
      const res = CloudflareAdapter.buildResponse();
      CloudflareAdapter.mergeHeaders(corsRes, res);
      const req: CloudflareRequest = {
        raw: request,
        method: request.method,
        url: url.pathname + url.search,
        originalUrl: url.pathname + url.search,
        path: url.pathname,
        baseUrl: '',
        protocol: 'https',
        secure: true,
        hostname: url.hostname,
        headers: request.headers,
        query: url.search ? parseQuery(url.searchParams) : emptyRecord(),
        params: emptyRecord(),
        cookies: parseCookies(request.headers.get('cookie')),
        files: emptyRecord<File>(),
        get: (name) => request.headers.get(name),
      };
      this.notFoundHandler(req, res);
      return CloudflareAdapter.toResponse(res, request.method);
    }
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
    });
    if (corsRes) {
      corsRes.headers.forEach((value, key) => headers.append(key, value));
    }
    return new Response(
      JSON.stringify({
        statusCode: 404,
        message: `Cannot ${request.method} ${url.pathname}`,
        error: 'Not Found',
      }),
      {
        status: 404,
        headers,
      },
    );
  }

  /**
   * Compute the `Access-Control-Allow-Origin` value.
   *
   * When `cors.origin` is explicitly configured, an empty resolution from
   * {@link resolveOrigin} is a deliberate *deny* and must NOT be reflected —
   * returning `''` so the caller omits the header. Only when no origin is
   * configured at all do we fall back to reflecting the request origin / `*`.
   */
  private static allowOrigin(
    cors: CloudflareCorsOptions,
    request: Request,
  ): string {
    const resolved = CloudflareAdapter.resolveOrigin(cors, request);
    if (resolved) {
      return resolved;
    }
    if (cors.origin !== undefined) {
      // Configured but denied — do not reflect a forbidden origin.
      return '';
    }
    return request.headers.get('origin') || '*';
  }

  /**
   * Resolve the `Access-Control-Allow-Origin` value the configured `origin`
   * rule yields for this request, returning `''` for a deny. Supports string,
   * boolean, RegExp, array and both function styles (value-returning and
   * Nest's callback form).
   *
   * @param cors The active CORS options.
   * @param request The request being answered.
   * @returns The allowed origin, or `''` when denied.
   */
  private static resolveOrigin(
    cors: CloudflareCorsOptions,
    request: Request,
  ): string {
    const requestOrigin = request.headers.get('origin') ?? '';
    if (typeof cors.origin === 'string') {
      return cors.origin;
    }
    if (typeof cors.origin === 'boolean') {
      return cors.origin ? requestOrigin || '*' : '';
    }
    if (cors.origin instanceof RegExp) {
      return cors.origin.test(requestOrigin) ? requestOrigin : '';
    }
    if (Array.isArray(cors.origin)) {
      return cors.origin.some((allowed) =>
        allowed instanceof RegExp
          ? allowed.test(requestOrigin)
          : allowed === requestOrigin,
      )
        ? requestOrigin
        : '';
    }
    if (typeof cors.origin === 'function') {
      const fn = cors.origin;
      // Nest's CustomOrigin is callback-style:
      // `(origin, cb: (err, allow) => void) => void`. Support both that and the
      // simpler value-returning form by branching on arity.
      if (fn.length >= 2) {
        let resolved = '';
        (
          fn as (
            o: string,
            cb: (e: Error | null, a?: boolean | string) => void,
          ) => void
        )(requestOrigin, (_err, allow) => {
          resolved =
            typeof allow === 'string' ? allow : allow ? requestOrigin : '';
        });
        return resolved;
      }
      const result = (fn as (o: string) => boolean | string)(requestOrigin);
      return typeof result === 'string' ? result : result ? requestOrigin : '';
    }
    // Deny by default rather than reflecting `*`, so a misconfigured/unknown
    // origin form cannot silently allow every origin.
    return '';
  }

  /**
   * Copy every header from `from` onto `to` (used to preserve CORS on 404s).
   *
   * @param from Source response whose headers to copy, or `undefined`.
   * @param to Destination response to append the headers onto.
   */
  private static mergeHeaders(
    from: CloudflareResponse | undefined,
    to: CloudflareResponse,
  ): void {
    if (!from) {
      return;
    }
    from.headers.forEach((value, key) => to.headers.append(key, value));
  }

  /**
   * Serialize the buffered {@link CloudflareResponse} into a native Web
   * `Response`, nulling the body where the runtime forbids one (HEAD, and
   * 1xx/204/205/304 statuses).
   *
   * @param res The buffered response.
   * @param method The request method, used to suppress the body for `HEAD`.
   * @returns The native `Response`.
   */
  private static toResponse(
    res: CloudflareResponse,
    method?: string,
  ): Response {
    // The Workers runtime (and the Fetch spec) forbid a non-null body on these
    // statuses and on HEAD; passing one throws. Null it out instead.
    const noBody =
      method === 'HEAD' ||
      res.statusCode === 204 ||
      res.statusCode === 205 ||
      res.statusCode === 304 ||
      res.statusCode < 200;
    return new Response(noBody ? null : res.body, {
      status: res.statusCode,
      headers: res.headers,
    });
  }

  /**
   * Build the URLPattern that decides whether a piece of middleware runs for a
   * given request path. Returns `null` (always-run) for the whole-app forms
   * Nest emits, and otherwise mounts the path as an Express-style PREFIX so
   * `use('/api', mw)` runs for `/api` AND every sub-path (`/api/users`).
   *
   * @param path The middleware mount path, or `null` for whole-app middleware.
   * @returns The gating pattern, or `null` if the middleware always runs.
   */
  private static middlewarePattern(
    path: string | null,
  ): URLPatternInstance | null {
    if (
      !path ||
      path === '*' ||
      path === '/' ||
      path === '/*' ||
      // Nest's whole-app wildcard forms (RouteInfoPathExtractor output).
      path === '/{*path}' ||
      path === '/(.*)' ||
      path === '*path' ||
      path === '/*path'
    ) {
      return null;
    }
    const normalized = normalizePathPattern(path);
    // Mount (prefix) semantics: a path-scoped middleware must run for the mount
    // path itself AND every nested sub-path (`/api` -> `/api`, `/api/users`).
    // A trailing optional named wildcard segment does exactly that and still
    // matches the bare mount path. If the path already ends in a wildcard
    // (a normalized catch-all like `/cats/:path*`), it already prefix-matches —
    // appending another would be redundant.
    const pattern = normalized.endsWith('*')
      ? normalized
      : `${normalized}/:__mwRest*`;
    return new URLPattern({ pathname: pattern });
  }

  /**
   * Resolve the version requested by the client per the configured versioning
   * strategy. URI versioning needs no resolution here — the version is already
   * baked into the matched path — so it is treated as always-matching.
   */
  private static resolveRequestedVersion(
    req: CloudflareRequest,
    options: VersioningOptions,
  ): string | string[] | null {
    switch (options.type) {
      case VersioningType.HEADER:
        return req.get(options.header);
      case VersioningType.MEDIA_TYPE: {
        const param = (req.get('accept') ?? '')
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(options.key));
        return param ? param.slice(options.key.length) : null;
      }
      case VersioningType.CUSTOM:
        return options.extractor(req);
      case VersioningType.URI:
      default:
        return null;
    }
  }

  /**
   * Decide whether a handler registered for `version` should serve a request
   * whose resolved version is `requested`.
   *
   * @param version The version(s) the handler serves.
   * @param requested The version resolved from the request, or `null` if the
   *   request supplied none.
   * @param options The active versioning strategy.
   * @returns `true` when the handler matches the requested version.
   */
  private static versionMatches(
    version: VersionValue,
    requested: string | string[] | null,
    options: VersioningOptions,
  ): boolean {
    // URI versioning is already resolved by the path match.
    if (options.type === VersioningType.URI) {
      return true;
    }
    const versions = Array.isArray(version) ? version : [version];
    const requestedList = (() => {
      if (requested === null) {
        return [];
      }
      if (Array.isArray(requested)) {
        return requested;
      }
      return [requested];
    })();
    // No version supplied by the request: VERSION_NEUTRAL acts as a wildcard.
    if (requestedList.length === 0) {
      return versions.includes(VERSION_NEUTRAL);
    }
    // A concrete version WAS supplied: match only on an exact version overlap;
    // VERSION_NEUTRAL in the array is ignored here (matches Nest core).
    return versions.some(
      (v) => typeof v === 'string' && requestedList.includes(v),
    );
  }
}

/**
 * Back-compat alias. The adapter was previously named `FetchAdapter`; the
 * public surface is unchanged.
 */
export { CloudflareAdapter as FetchAdapter };
