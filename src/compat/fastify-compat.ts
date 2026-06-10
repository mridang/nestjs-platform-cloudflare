import type {
  CloudflareRequest,
  CloudflareResponse,
} from '../adapters/cloudflare-adapter.js';

/**
 * Fastify-compatible request object.
 *
 * Presents a Fastify `FastifyRequest`-shaped surface backed by a
 * {@link CloudflareRequest}, so Fastify hooks and handlers can read request
 * data unchanged.
 */
export interface FastifyCompatRequest {
  /** Unique per-request identifier. */
  id: string;
  /** Route parameters extracted from the matched path. */
  params: Record<string, string | undefined>;
  /** Parsed query string, with repeated keys collected into arrays. */
  query: Record<string, string | string[]>;
  /** Parsed request body. */
  body: unknown;
  /** Request headers, lower-cased and grouped (array for repeated keys). */
  headers: Record<string, string | string[] | undefined>;
  /** The underlying native Web `Request`. */
  raw: Request;

  /** Request URL including path and query string. */
  url: string;
  /** Original request URL before any internal rewriting. */
  originalUrl: string;
  /** HTTP method of the request. */
  method: string;
  /** Host name derived from the request URL. */
  hostname: string;
  /** Client IP address, when available. */
  ip: string | undefined;
  /** Request protocol (`http` or `https`). */
  protocol: 'http' | 'https';

  /** Path of the route that matched this request. */
  routerPath?: string;
  /** HTTP method of the route that matched this request. */
  routerMethod?: string;

  /** Validation error attached by a validation hook, if any. */
  validationError?: Error;

  /** Index signature for custom properties hooks/plugins may attach. */
  [key: string]: unknown;
}

/**
 * Fastify-compatible reply object.
 *
 * Presents a Fastify `FastifyReply`-shaped surface backed by a
 * {@link CloudflareResponse}, so Fastify hooks and handlers can build the
 * response unchanged. Mutator methods return `this` for chaining.
 */
export interface FastifyCompatReply {
  /** HTTP status code to send. */
  statusCode: number;
  /** Whether a response has already been produced. */
  sent: boolean;

  /**
   * Set the response status code.
   * @param statusCode HTTP status code.
   * @returns This reply, for chaining.
   */
  code(statusCode: number): this;
  /**
   * Alias for {@link FastifyCompatReply.code}.
   * @param statusCode HTTP status code.
   * @returns This reply, for chaining.
   */
  status(statusCode: number): this;

  /**
   * Set a single response header.
   * @param key Header name.
   * @param value Header value.
   * @returns This reply, for chaining.
   */
  header(key: string, value: string | number | boolean): this;
  /**
   * Set multiple response headers at once.
   * @param headers Map of header names to values.
   * @returns This reply, for chaining.
   */
  headers(headers: Record<string, string | number | boolean>): this;
  /**
   * Read a response header value.
   * @param key Header name.
   * @returns The header value, or `undefined` if absent.
   */
  getHeader(key: string): string | string[] | undefined;
  /**
   * Read all response headers as a plain object.
   * @returns The current response headers.
   */
  getHeaders(): Record<string, string | string[] | undefined>;
  /**
   * Remove a response header.
   * @param key Header name.
   * @returns This reply, for chaining.
   */
  removeHeader(key: string): this;
  /**
   * Whether a response header is set.
   * @param key Header name.
   * @returns `true` if the header is present.
   */
  hasHeader(key: string): boolean;

  /**
   * Send the response payload, inferring `Content-Type` from its kind.
   * @param payload Payload to send.
   * @returns This reply, for chaining.
   */
  send(payload?: unknown): this;

  /**
   * Serialize a payload using the active serializer.
   * @param payload Value to serialize.
   * @returns The serialized string.
   */
  serialize(payload: unknown): string;
  /**
   * Replace the serializer used by {@link FastifyCompatReply.send}.
   * @param fn New serializer function.
   * @returns This reply, for chaining.
   */
  serializer(fn: (payload: unknown) => string): this;

  /**
   * Set the response `Content-Type`.
   * @param contentType MIME type.
   * @returns This reply, for chaining.
   */
  type(contentType: string): this;

  /**
   * Redirect the client to a URL, optionally with a status code.
   * @param url Target URL (or status code when followed by `url`).
   * @param statusCode Status code when the first argument is the URL position.
   * @returns This reply, for chaining.
   */
  redirect(url: string): this;
  redirect(statusCode: number, url: string): this;

  /** Produce the framework's standard 404 Not Found response. */
  callNotFound(): void;
  /**
   * Elapsed time since the reply was created.
   * @returns The response time in milliseconds.
   */
  getResponseTime(): number;

  /** The underlying {@link CloudflareResponse}. */
  raw: CloudflareResponse;

  /** Index signature for custom properties hooks/plugins may attach. */
  [key: string]: unknown;
}

/**
 * Fastify hook types.
 */
export type FastifyHookName =
  | 'onRequest'
  | 'preParsing'
  | 'preValidation'
  | 'preHandler'
  | 'preSerialization'
  | 'onSend'
  | 'onResponse'
  | 'onError'
  | 'onTimeout'
  | 'onReady'
  | 'onClose';

/**
 * Fastify done callback.
 */
export type FastifyDoneCallback = (err?: Error) => void;

/**
 * Fastify hook function (callback style).
 */
export type FastifyHookCallback = (
  request: FastifyCompatRequest,
  reply: FastifyCompatReply,
  done: FastifyDoneCallback,
) => void;

/**
 * Fastify hook function (async style).
 */
export type FastifyHookAsync = (
  request: FastifyCompatRequest,
  reply: FastifyCompatReply,
) => Promise<void>;

/**
 * Fastify hook function (either style).
 */
export type FastifyHook = FastifyHookCallback | FastifyHookAsync;

/**
 * Fastify onError hook.
 */
export type FastifyErrorHook = (
  request: FastifyCompatRequest,
  reply: FastifyCompatReply,
  error: Error,
  done: FastifyDoneCallback,
) => void;

/**
 * Fastify onSend hook with payload.
 */
export type FastifyOnSendHook = (
  request: FastifyCompatRequest,
  reply: FastifyCompatReply,
  payload: unknown,
  done: (err?: Error, payload?: unknown) => void,
) => void;

/**
 * Fastify plugin function.
 */
export type FastifyPlugin<Options = Record<string, unknown>> = (
  instance: FastifyLikeInstance,
  opts: Options,
  done: FastifyDoneCallback,
) => void;

/**
 * Fastify async plugin function.
 */
export type FastifyPluginAsync<Options = Record<string, unknown>> = (
  instance: FastifyLikeInstance,
  opts: Options,
) => Promise<void>;

/**
 * Fastify route handler.
 */
export type FastifyRouteHandler = (
  request: FastifyCompatRequest,
  reply: FastifyCompatReply,
) => unknown | Promise<unknown>;

/**
 * Options describing a single Fastify route registration.
 */
export interface FastifyRouteOptions {
  /** HTTP method(s) the route responds to. */
  method: string | string[];
  /** Route path. */
  url: string;
  /** Handler invoked once the route's hooks have run. */
  handler: FastifyRouteHandler;
  /** Validation/serialization schema (accepted for parity; not enforced). */
  schema?: unknown;
  /** Hook(s) run before validation. */
  preValidation?: FastifyHook | FastifyHook[];
  /** Hook(s) run immediately before the handler. */
  preHandler?: FastifyHook | FastifyHook[];
  /** Hook(s) run before payload serialization. */
  preSerialization?: FastifyOnSendHook | FastifyOnSendHook[];
  /** Hook(s) run as soon as the request is received. */
  onRequest?: FastifyHook | FastifyHook[];
  /** Hook(s) run after the response is sent. */
  onResponse?: FastifyHook | FastifyHook[];
  /** Hook(s) run as the payload is being sent. */
  onSend?: FastifyOnSendHook | FastifyOnSendHook[];
  /** Hook(s) run when the route handler throws. */
  onError?: FastifyErrorHook | FastifyErrorHook[];
}

/**
 * Minimal Fastify-like instance for plugins and hooks that expect a Fastify
 * application object. Returned by {@link CloudflareAdapter.getFastifyInstance}.
 */
export interface FastifyLikeInstance {
  /** Decorate the instance with a named value. */
  decorate(name: string, value: unknown): this;
  /** Decorate every request with a named value. */
  decorateRequest(name: string, value: unknown): this;
  /** Decorate every reply with a named value. */
  decorateReply(name: string, value: unknown): this;
  /** Whether an instance decorator exists. */
  hasDecorator(name: string): boolean;
  /** Whether a request decorator exists. */
  hasRequestDecorator(name: string): boolean;
  /** Whether a reply decorator exists. */
  hasReplyDecorator(name: string): boolean;

  /** Register a lifecycle hook by name. */
  addHook(name: 'onRequest', hook: FastifyHook): this;
  addHook(name: 'preParsing', hook: FastifyHook): this;
  addHook(name: 'preValidation', hook: FastifyHook): this;
  addHook(name: 'preHandler', hook: FastifyHook): this;
  addHook(name: 'preSerialization', hook: FastifyOnSendHook): this;
  addHook(name: 'onSend', hook: FastifyOnSendHook): this;
  addHook(name: 'onResponse', hook: FastifyHook): this;
  addHook(name: 'onError', hook: FastifyErrorHook): this;
  addHook(
    name: FastifyHookName,
    hook: FastifyHook | FastifyErrorHook | FastifyOnSendHook,
  ): this;

  /** Register a Fastify plugin (sync or async). */
  register<Options = Record<string, unknown>>(
    plugin: FastifyPlugin<Options> | FastifyPluginAsync<Options>,
    opts?: Options,
  ): this;

  /** Register a route from a full options object. */
  route(opts: FastifyRouteOptions): this;
  /** Register a `GET` route. */
  get(path: string, handler: FastifyRouteHandler): this;
  get(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a `POST` route. */
  post(path: string, handler: FastifyRouteHandler): this;
  post(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a `PUT` route. */
  put(path: string, handler: FastifyRouteHandler): this;
  put(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a `DELETE` route. */
  delete(path: string, handler: FastifyRouteHandler): this;
  delete(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a `PATCH` route. */
  patch(path: string, handler: FastifyRouteHandler): this;
  patch(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register an `OPTIONS` route. */
  options(path: string, handler: FastifyRouteHandler): this;
  options(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a `HEAD` route. */
  head(path: string, handler: FastifyRouteHandler): this;
  head(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;
  /** Register a route for every supported HTTP verb. */
  all(path: string, handler: FastifyRouteHandler): this;
  all(
    path: string,
    opts: Partial<FastifyRouteOptions>,
    handler: FastifyRouteHandler,
  ): this;

  /** Instance logger. */
  log: FastifyLogger;
  /** Route prefix applied to registrations on this instance. */
  prefix: string;
}

/**
 * Minimal logger matching the subset of Fastify's logger interface used by the
 * compatibility layer.
 */
export interface FastifyLogger {
  /** Log at the `info` level. */
  info(msg: string, ...args: unknown[]): void;
  /** Log at the `error` level. */
  error(msg: string, ...args: unknown[]): void;
  /** Log at the `debug` level. */
  debug(msg: string, ...args: unknown[]): void;
  /** Log at the `warn` level. */
  warn(msg: string, ...args: unknown[]): void;
  /** Log at the `trace` level. */
  trace(msg: string, ...args: unknown[]): void;
  /** Log at the `fatal` level. */
  fatal(msg: string, ...args: unknown[]): void;
  /**
   * Create a child logger that prefixes messages with the given bindings.
   * @param bindings Key/value pairs prepended to each message.
   * @returns A child logger.
   */
  child(bindings: Record<string, unknown>): FastifyLogger;
}

/** Monotonic counter backing {@link generateRequestId}. */
let requestIdCounter = 0;

/**
 * Generate a unique-per-process request identifier.
 *
 * @returns A request id of the form `req-<timestamp>-<counter>`.
 */
function generateRequestId(): string {
  return `req-${Date.now()}-${++requestIdCounter}`;
}

/**
 * Convert native `Headers` into a plain object keyed by lower-cased header
 * name, collecting repeated headers into arrays.
 *
 * @param headers Native Web `Headers` to convert.
 * @returns A plain headers object.
 */
function headersToObject(
  headers: Headers,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    const existing = result[lowerKey];
    if (existing) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[lowerKey] = [existing, value];
      }
    } else {
      result[lowerKey] = value;
    }
  });
  return result;
}

/**
 * Build a Fastify-compatible request wrapper over a {@link CloudflareRequest}.
 *
 * @param cfReq The adapter request to wrap.
 * @returns A Fastify-shaped request that reads from `cfReq`.
 */
export function createFastifyRequest(
  cfReq: CloudflareRequest,
): FastifyCompatRequest {
  const headersObj = headersToObject(cfReq.headers);

  const req: FastifyCompatRequest = {
    id: generateRequestId(),
    // Shallow-copy so hooks/handlers can mutate without hitting a frozen
    // empty sentinel (object is not extensible).
    params: { ...cfReq.params },
    query: { ...cfReq.query },
    body: cfReq.body,
    headers: headersObj,
    raw: cfReq.raw,
    url: cfReq.originalUrl || cfReq.path || '/',
    originalUrl: cfReq.originalUrl || cfReq.path || '/',
    method: cfReq.method,
    hostname: cfReq.hostname || '',
    ip: cfReq.ip,
    protocol: cfReq.secure === false ? 'http' : 'https',
    routerPath: cfReq.path,
    routerMethod: cfReq.method,
  };

  return req;
}

/**
 * Build a Fastify-compatible reply wrapper over a {@link CloudflareResponse}.
 *
 * @param cfRes The adapter response to wrap.
 * @returns A Fastify-shaped reply that writes through to `cfRes`.
 */
export function createFastifyReply(
  cfRes: CloudflareResponse,
): FastifyCompatReply {
  let serializer: (payload: unknown) => string = JSON.stringify;
  const startTime = Date.now();

  const reply: FastifyCompatReply = {
    get statusCode() {
      return cfRes.statusCode;
    },
    set statusCode(code: number) {
      cfRes.statusCode = code;
    },
    get sent() {
      return cfRes.sent;
    },

    raw: cfRes,

    code(statusCode: number) {
      cfRes.status(statusCode);
      return this;
    },

    status(statusCode: number) {
      return this.code(statusCode);
    },

    header(key: string, value: string | number | boolean) {
      cfRes.setHeader(key, String(value));
      return this;
    },

    headers(headers: Record<string, string | number | boolean>) {
      Object.entries(headers).forEach(([key, value]) => {
        cfRes.setHeader(key, String(value));
      });
      return this;
    },

    getHeader(key: string) {
      if (key.toLowerCase() === 'set-cookie') {
        // Set-Cookie values contain commas; return the array form, never join.
        const cookies = cfRes.getSetCookie();
        return cookies.length > 0 ? cookies : undefined;
      }
      return cfRes.getHeader(key) || undefined;
    },

    getHeaders() {
      const result: Record<string, string | string[] | undefined> = {};
      cfRes.headers.forEach((value, key) => {
        result[key] = value;
      });
      const cookies = cfRes.getSetCookie();
      if (cookies.length > 0) {
        result['set-cookie'] = cookies;
      }
      return result;
    },

    removeHeader(key: string) {
      cfRes.removeHeader(key);
      return this;
    },

    hasHeader(key: string) {
      return cfRes.getHeader(key) !== null;
    },

    send(payload?: unknown) {
      if (payload === undefined) {
        cfRes.end();
      } else if (typeof payload === 'string') {
        if (!cfRes.getHeader('Content-Type')) {
          cfRes.setHeader('Content-Type', 'text/plain; charset=utf-8');
        }
        cfRes.send(payload);
      } else if (
        payload instanceof Uint8Array ||
        payload instanceof ArrayBuffer
      ) {
        if (!cfRes.getHeader('Content-Type')) {
          cfRes.setHeader('Content-Type', 'application/octet-stream');
        }
        // eslint-disable-next-line no-undef
        cfRes.send(payload as BodyInit);
      } else if (typeof payload === 'object') {
        if (!cfRes.getHeader('Content-Type')) {
          cfRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        cfRes.send(serializer(payload));
      } else {
        cfRes.send(String(payload));
      }
      return this;
    },

    serialize(payload: unknown) {
      return serializer(payload);
    },

    serializer(fn: (payload: unknown) => string) {
      serializer = fn;
      return this;
    },

    type(contentType: string) {
      cfRes.setHeader('Content-Type', contentType);
      return this;
    },

    redirect(statusCodeOrUrl: number | string, url?: string) {
      if (typeof statusCodeOrUrl === 'number' && url) {
        cfRes.redirect(url, statusCodeOrUrl);
      } else if (typeof statusCodeOrUrl === 'string') {
        cfRes.redirect(statusCodeOrUrl, 302);
      }
      return this;
    },

    callNotFound() {
      cfRes.status(404).json({
        statusCode: 404,
        error: 'Not Found',
        message: 'Route not found',
      });
    },

    getResponseTime() {
      return Date.now() - startTime;
    },
  };

  return reply;
}

/**
 * Determine whether a hook is the async (Promise-returning, no `done`) style,
 * by inspecting its declared argument count.
 *
 * @param hook The hook to classify.
 * @returns `true` if the hook is async-style.
 */
function isAsyncHook(hook: FastifyHook): hook is FastifyHookAsync {
  return hook.length <= 2;
}

/**
 * Wrap a Fastify hook so it runs inside the adapter's middleware chain,
 * supporting both async and `done`-callback hook styles.
 *
 * @param hook The Fastify hook to wrap.
 * @returns A middleware function compatible with the adapter chain.
 */
export function wrapFastifyHook(
  hook: FastifyHook,
): (
  req: CloudflareRequest,
  res: CloudflareResponse,
  next: () => void,
) => Promise<void> {
  return async (
    cfReq: CloudflareRequest,
    cfRes: CloudflareResponse,
    next: () => void,
  ) => {
    const fastifyReq = createFastifyRequest(cfReq);
    const fastifyReply = createFastifyReply(cfRes);

    if (isAsyncHook(hook)) {
      await hook(fastifyReq, fastifyReply);
      if (!fastifyReply.sent) {
        next();
      }
    } else {
      return new Promise<void>((resolve, reject) => {
        const done: FastifyDoneCallback = (err?: Error) => {
          if (err) {
            reject(err);
          } else if (!fastifyReply.sent) {
            next();
            resolve();
          } else {
            resolve();
          }
        };

        try {
          (hook as FastifyHookCallback)(fastifyReq, fastifyReply, done);
        } catch (err) {
          reject(err);
        }
      });
    }
  };
}

/**
 * Run a Fastify plugin against a {@link FastifyLikeInstance}, letting plugins
 * that register hooks or decorators work with the adapter. Supports both
 * async and `done`-callback plugin styles.
 *
 * @param plugin The Fastify plugin to run.
 * @param instance The instance the plugin registers against.
 * @param opts Options passed to the plugin.
 * @returns A promise that resolves once the plugin finishes.
 */
export function wrapFastifyPlugin<Options = Record<string, unknown>>(
  plugin: FastifyPlugin<Options> | FastifyPluginAsync<Options>,
  instance: FastifyLikeInstance,
  opts: Options = {} as Options,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (plugin.length <= 2) {
      // Async plugin
      const result = (plugin as FastifyPluginAsync<Options>)(instance, opts);
      if (result instanceof Promise) {
        result.then(resolve).catch(reject);
      } else {
        resolve();
      }
    } else {
      // Callback plugin
      try {
        (plugin as FastifyPlugin<Options>)(instance, opts, (err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    }
  });
}

/**
 * Create a simple console-backed logger implementing {@link FastifyLogger}.
 *
 * @returns A logger whose `child()` prefixes messages with its bindings.
 */
export function createFastifyLogger(): FastifyLogger {
  const createLogFn =
    (level: string) =>
    (msg: string, ...args: unknown[]) => {
      console.log(`[${level.toUpperCase()}] ${msg}`, ...args);
    };

  return {
    info: createLogFn('info'),
    error: createLogFn('error'),
    debug: createLogFn('debug'),
    warn: createLogFn('warn'),
    trace: createLogFn('trace'),
    fatal: createLogFn('fatal'),
    child(bindings: Record<string, unknown>) {
      const prefix = Object.entries(bindings)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const childLog = createFastifyLogger();
      const wrap =
        (fn: (msg: string, ...args: unknown[]) => void) =>
        (msg: string, ...args: unknown[]) =>
          fn(`[${prefix}] ${msg}`, ...args);
      return {
        ...childLog,
        info: wrap(childLog.info),
        error: wrap(childLog.error),
        debug: wrap(childLog.debug),
        warn: wrap(childLog.warn),
        trace: wrap(childLog.trace),
        fatal: wrap(childLog.fatal),
      };
    },
  };
}
