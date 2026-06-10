import type {
  CloudflareRequest,
  CloudflareResponse,
} from '../adapters/cloudflare-adapter.js';

/**
 * Express-compatible request object.
 *
 * Presents an Express `Request`-shaped surface backed by a
 * {@link CloudflareRequest}, so Express middleware can read request data and
 * call the usual accessor methods unchanged.
 */
export interface ExpressCompatRequest {
  /** HTTP method of the request (e.g. `GET`, `POST`). */
  method: string;
  /** Request URL including path and query string. */
  url: string;
  /** Original request URL before any internal rewriting. */
  originalUrl: string;
  /** Mount path the request was matched under (empty for the root app). */
  baseUrl: string;
  /** Request path without the query string. */
  path: string;
  /** Host name derived from the request URL. */
  hostname: string;
  /** Client IP address, when available. */
  ip: string | undefined;
  /** Request protocol (`http` or `https`). */
  protocol: string;
  /** Whether the request was made over a secure (TLS) connection. */
  secure: boolean;
  /** Request headers, lower-cased and grouped (array for repeated keys). */
  headers: Record<string, string | string[] | undefined>;

  /** Route parameters extracted from the matched path. */
  params: Record<string, string | undefined>;
  /** Parsed query string, with repeated keys collected into arrays. */
  query: Record<string, string | string[]>;
  /** Parsed request body. */
  body: unknown;

  /**
   * Return a request header value by name (case-insensitive).
   * @param name Header name.
   * @returns The header value, or `undefined` if absent.
   */
  get(name: string): string | undefined;
  /**
   * Alias for {@link ExpressCompatRequest.get}.
   * @param name Header name.
   * @returns The header value, or `undefined` if absent.
   */
  header(name: string): string | undefined;
  /**
   * Test whether the request's `Content-Type` matches the given type(s).
   * @param type Type or list of types to test against.
   * @returns The matched type, `false` if none match, or `null` if no
   *   `Content-Type` is present.
   */
  is(type: string | string[]): string | false | null;
  /**
   * Negotiate the best response type against the `Accept` header.
   * @param types Candidate types in preference order.
   * @returns The best matching type, or `false` if none are acceptable.
   */
  accepts(...types: string[]): string | false;
  /**
   * Negotiate the best encoding against the `Accept-Encoding` header.
   * @param encodings Candidate encodings in preference order.
   * @returns The best matching encoding, or `false` if none are acceptable.
   */
  acceptsEncodings(...encodings: string[]): string | false;
  /**
   * Negotiate the best charset against the `Accept-Charset` header.
   * @param charsets Candidate charsets in preference order.
   * @returns The best matching charset, or `false` if none are acceptable.
   */
  acceptsCharsets(...charsets: string[]): string | false;
  /**
   * Negotiate the best language against the `Accept-Language` header.
   * @param langs Candidate languages in preference order.
   * @returns The best matching language, or `false` if none are acceptable.
   */
  acceptsLanguages(...langs: string[]): string | false;

  /** The underlying native Web `Request`. */
  raw: Request;

  /** Parsed request cookies keyed by name. */
  cookies?: Record<string, string>;
  /** Parsed signed cookies keyed by name. */
  signedCookies?: Record<string, string>;
  /** Whether the response is still fresh relative to the request's validators. */
  fresh?: boolean;
  /** Inverse of {@link ExpressCompatRequest.fresh}. */
  stale?: boolean;
  /** Whether the request was made via XMLHttpRequest. */
  xhr?: boolean;
  /** Subdomains of the host name, ordered from the outermost label inward. */
  subdomains?: string[];

  /** Index signature for arbitrary properties Express middleware may attach. */
  [key: string]: unknown;
}

/**
 * Express-compatible response object.
 *
 * Presents an Express `Response`-shaped surface backed by a
 * {@link CloudflareResponse}, exposing both the Express helper methods and the
 * Node `http.ServerResponse` methods (`setHeader`/`getHeader`) that middleware
 * such as `helmet` call directly.
 */
export interface ExpressCompatResponse {
  /** HTTP status code to send. */
  statusCode: number;
  /** Reason phrase associated with the status code. */
  statusMessage: string;
  /** Whether the response headers have been committed. */
  headersSent: boolean;

  /**
   * Set the response status code.
   * @param code HTTP status code.
   * @returns This response, for chaining.
   */
  status(code: number): this;
  /**
   * Set the status code and send its standard reason phrase as the body.
   * @param code HTTP status code.
   * @returns This response, for chaining.
   */
  sendStatus(code: number): this;

  /**
   * Set one header, or many headers from an object.
   * @param field Header name, or a map of header names to values.
   * @param value Header value when `field` is a string.
   * @returns This response, for chaining.
   */
  set(field: string, value: string | string[]): this;
  set(field: Record<string, string | string[]>): this;
  /**
   * Get or set a header depending on whether `value` is supplied.
   * @param field Header name.
   * @param value Value to set; omit to read the current value.
   * @returns This response when setting, or the header value when reading.
   */
  header(
    field: string,
    value?: string | string[],
  ): this | string | string[] | undefined;
  /**
   * Read a response header value.
   * @param field Header name.
   * @returns The header value, or `undefined` if absent.
   */
  get(field: string): string | string[] | undefined;
  /**
   * Append a value to a header without replacing existing values.
   * @param field Header name.
   * @param value Value(s) to append.
   * @returns This response, for chaining.
   */
  append(field: string, value: string | string[]): this;

  /**
   * Node `http.ServerResponse`-style header setter (replace semantics).
   * @param field Header name.
   * @param value Header value(s).
   */
  setHeader(field: string, value: string | number | string[]): void;
  /**
   * Node `http.ServerResponse`-style header getter.
   * @param field Header name.
   * @returns The header value, or `undefined` if absent.
   */
  getHeader(field: string): string | number | string[] | undefined;
  /**
   * Node `http.ServerResponse`-style header remover.
   * @param field Header name.
   */
  removeHeader(field: string): void;

  /**
   * Send a response body, inferring `Content-Type` from its kind.
   * @param body Body to send.
   * @returns This response, for chaining.
   */
  send(body?: unknown): this;
  /**
   * Send a JSON response body.
   * @param body Value to serialize as JSON.
   * @returns This response, for chaining.
   */
  json(body?: unknown): this;
  /**
   * Send a JSONP response body (currently serialized as plain JSON).
   * @param body Value to serialize.
   * @returns This response, for chaining.
   */
  jsonp(body?: unknown): this;
  /**
   * End the response, optionally writing a final chunk.
   * @param data Optional final body chunk.
   * @param encoding Accepted for parity; ignored.
   * @returns This response, for chaining.
   */
  end(data?: unknown, encoding?: string): this;

  /**
   * Redirect the client to a URL, optionally with a status code.
   * @param url Target URL (or status code when followed by `url`).
   * @param status Status code when the first argument is the URL position.
   */
  redirect(url: string): void;
  redirect(status: number, url: string): void;

  /**
   * Set `Content-Type` from a type name or full MIME type.
   * @param type Shorthand (e.g. `json`) or a full MIME type.
   * @returns This response, for chaining.
   */
  type(type: string): this;
  /**
   * Alias for {@link ExpressCompatResponse.type}.
   * @param type Shorthand or full MIME type.
   * @returns This response, for chaining.
   */
  contentType(type: string): this;

  /**
   * Append a `Set-Cookie` header for the given cookie.
   * @param name Cookie name.
   * @param value Cookie value.
   * @param options Cookie attributes.
   * @returns This response, for chaining.
   */
  cookie(name: string, value: string, options?: CookieOptions): this;
  /**
   * Append a `Set-Cookie` header that expires the named cookie.
   * @param name Cookie name.
   * @param options Cookie attributes used when clearing.
   * @returns This response, for chaining.
   */
  clearCookie(name: string, options?: CookieOptions): this;

  /**
   * Set the `Location` header.
   * @param url Location URL.
   * @returns This response, for chaining.
   */
  location(url: string): this;
  /**
   * Set the `Link` header from a relation-to-URL map.
   * @param links Map of link relations to URLs.
   * @returns This response, for chaining.
   */
  links(links: Record<string, string>): this;
  /**
   * Append a field to the `Vary` header.
   * @param field Header field to vary on.
   * @returns This response, for chaining.
   */
  vary(field: string): this;
  /**
   * Run the content-negotiation branch matching the request's `Accept` header.
   * @param obj Map of types to handlers, with an optional `default`.
   * @returns This response, for chaining.
   */
  format(obj: Record<string, () => void>): this;

  /** Index signature for arbitrary properties Express middleware may attach. */
  [key: string]: unknown;
}

/**
 * Attributes for a `Set-Cookie` header, mirroring Express's cookie options.
 */
export interface CookieOptions {
  /** `Domain` attribute scoping the cookie to a host. */
  domain?: string;
  /** Custom encoder applied to the cookie value. */
  encode?: (value: string) => string;
  /** Absolute expiry date (`Expires` attribute). */
  expires?: Date;
  /** Whether to set the `HttpOnly` attribute. */
  httpOnly?: boolean;
  /** Relative lifetime in seconds (`Max-Age` attribute). */
  maxAge?: number;
  /** `Path` attribute scoping the cookie (defaults to `/`). */
  path?: string;
  /** `SameSite` attribute; `true` maps to `Strict`. */
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  /** Whether to set the `Secure` attribute. */
  secure?: boolean;
  /** Whether the cookie should be signed. */
  signed?: boolean;
}

/**
 * Express `next` callback. Calling it with an error advances to the next error
 * handler; calling it without one advances to the next middleware.
 */
export type ExpressNextFunction = (err?: unknown) => void;

/**
 * Signature of a standard (3-argument) Express middleware function.
 */
export type ExpressMiddleware = (
  req: ExpressCompatRequest,
  res: ExpressCompatResponse,
  next: ExpressNextFunction,
) => void | Promise<void>;

/**
 * Signature of a 4-argument Express error-handling middleware function.
 */
export type ExpressErrorMiddleware = (
  err: unknown,
  req: ExpressCompatRequest,
  res: ExpressCompatResponse,
  next: ExpressNextFunction,
) => void | Promise<void>;

/** Standard HTTP reason phrases keyed by status code. */
const STATUS_MESSAGES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

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
    const existing = result[key.toLowerCase()];
    if (existing) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key.toLowerCase()] = [existing, value];
      }
    } else {
      result[key.toLowerCase()] = value;
    }
  });
  return result;
}

/**
 * Parse an `Accept`-family header and pick the best match among candidate
 * types, honouring `q` weights and `*`/`type/*` wildcards.
 *
 * @param acceptHeader The raw header value, or `undefined` if absent.
 * @param types Candidate types in caller preference order.
 * @returns The best matching type, or `false` if none are acceptable.
 */
function parseAccept(
  acceptHeader: string | undefined,
  types: string[],
): string | false {
  if (!acceptHeader || types.length === 0) {
    return false;
  }

  const accepts = acceptHeader
    .split(',')
    .map((part) => {
      const [type, ...params] = part.trim().split(';');
      let quality = 1;
      params.forEach((param) => {
        const [key, value] = param.trim().split('=');
        if (key === 'q') {
          quality = parseFloat(value) || 1;
        }
      });
      return { type: type.trim(), quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const accept of accepts) {
    for (const type of types) {
      if (
        accept.type === '*/*' ||
        accept.type === type ||
        (accept.type.endsWith('/*') &&
          type.startsWith(accept.type.slice(0, -1)))
      ) {
        return type;
      }
    }
  }

  return false;
}

/**
 * Serialize a cookie name/value pair plus attributes into a `Set-Cookie` value.
 *
 * @param name Cookie name.
 * @param value Cookie value.
 * @param options Cookie attributes.
 * @returns The serialized `Set-Cookie` header value.
 */
function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge !== undefined) {
    cookie += `; Max-Age=${options.maxAge}`;
  }
  if (options.domain) {
    cookie += `; Domain=${options.domain}`;
  }
  if (options.path) {
    cookie += `; Path=${options.path}`;
  } else {
    cookie += '; Path=/';
  }
  if (options.expires) {
    cookie += `; Expires=${options.expires.toUTCString()}`;
  }
  if (options.httpOnly) {
    cookie += '; HttpOnly';
  }
  if (options.secure) {
    cookie += '; Secure';
  }
  if (options.sameSite) {
    if (options.sameSite === true) {
      cookie += '; SameSite=Strict';
    } else {
      cookie += `; SameSite=${
        options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)
      }`;
    }
  }

  return cookie;
}

/**
 * Build an Express-compatible request wrapper over a {@link CloudflareRequest}.
 *
 * @param cfReq The adapter request to wrap.
 * @returns An Express-shaped request that reads from `cfReq`.
 */
export function createExpressRequest(
  cfReq: CloudflareRequest,
): ExpressCompatRequest {
  const headersObj = headersToObject(cfReq.headers);

  const cookieHeader = cfReq.headers.get('cookie') || '';
  const cookies: Record<string, string> = { ...cfReq.cookies };
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name) {
      cookies[decodeURIComponent(name.trim())] = decodeURIComponent(
        valueParts.join('='),
      );
    }
  });

  const req: ExpressCompatRequest = {
    method: cfReq.method,
    url: cfReq.originalUrl || cfReq.path || '/',
    originalUrl: cfReq.originalUrl || cfReq.path || '/',
    baseUrl: cfReq.baseUrl || '',
    path: cfReq.path || '/',
    hostname: cfReq.hostname || '',
    ip: cfReq.ip,
    protocol: cfReq.protocol || 'https',
    secure: cfReq.secure ?? true,
    headers: headersObj,

    // Shallow-copy so middleware can safely mutate these (query sanitizers,
    // param injectors, etc.) without hitting the adapter's frozen empty
    // sentinel — `Cannot add property X, object is not extensible`.
    params: { ...cfReq.params },
    query: { ...cfReq.query },
    body: cfReq.body,

    raw: cfReq.raw,

    cookies,
    signedCookies: {},

    xhr:
      cfReq.headers.get('x-requested-with')?.toLowerCase() === 'xmlhttprequest',
    subdomains: cfReq.hostname?.split('.').slice(0, -2).reverse() || [],

    get(name: string): string | undefined {
      const key = name.toLowerCase();
      const value = headersObj[key];
      return Array.isArray(value) ? value[0] : value;
    },

    header(name: string): string | undefined {
      return this.get(name);
    },

    is(type: string | string[]): string | false | null {
      const contentType = cfReq.headers.get('content-type');
      if (!contentType) {
        return null;
      }

      const types = Array.isArray(type) ? type : [type];
      for (const candidate of types) {
        if (
          contentType.includes(candidate) ||
          contentType.includes(candidate.replace('/', ''))
        ) {
          return candidate;
        }
      }
      return false;
    },

    accepts(...types: string[]): string | false {
      return parseAccept(cfReq.headers.get('accept') || undefined, types);
    },

    acceptsEncodings(...encodings: string[]): string | false {
      return parseAccept(
        cfReq.headers.get('accept-encoding') || undefined,
        encodings,
      );
    },

    acceptsCharsets(...charsets: string[]): string | false {
      return parseAccept(
        cfReq.headers.get('accept-charset') || undefined,
        charsets,
      );
    },

    acceptsLanguages(...langs: string[]): string | false {
      return parseAccept(
        cfReq.headers.get('accept-language') || undefined,
        langs,
      );
    },
  };

  // Freshness must be computed by comparing the request's conditional headers
  // against the RESPONSE's ETag/Last-Modified — the mere presence of
  // If-Modified-Since / If-None-Match does NOT make a request fresh. We have no
  // response validators to compare against here, so use Express's safe default
  // (no validators compared => not fresh) rather than deriving truthiness from
  // request header presence, which wrongly 304s every conditional GET.
  req.fresh = false;
  req.stale = true;

  return req;
}

/**
 * Build an Express-compatible response wrapper over a {@link CloudflareResponse}.
 *
 * @param cfRes The adapter response to wrap.
 * @returns An Express-shaped response that writes through to `cfRes`.
 */
export function createExpressResponse(
  cfRes: CloudflareResponse,
): ExpressCompatResponse {
  let statusMessage = 'OK';
  const cookies: string[] = [];

  const res: ExpressCompatResponse = {
    get statusCode() {
      return cfRes.statusCode;
    },
    set statusCode(code: number) {
      cfRes.statusCode = code;
      statusMessage = STATUS_MESSAGES[code] || 'Unknown';
    },
    get statusMessage() {
      return statusMessage;
    },
    set statusMessage(msg: string) {
      statusMessage = msg;
    },
    get headersSent() {
      return cfRes.headersSent;
    },

    status(code: number) {
      cfRes.status(code);
      statusMessage = STATUS_MESSAGES[code] || 'Unknown';
      return this;
    },

    sendStatus(code: number) {
      this.status(code);
      cfRes.send(STATUS_MESSAGES[code] || String(code));
      return this;
    },

    set(
      field: string | Record<string, string | string[]>,
      value?: string | string[],
    ) {
      if (typeof field === 'object') {
        Object.entries(field).forEach(([key, val]) => {
          if (Array.isArray(val)) {
            // Replace semantics: discard any prior value, then append each item.
            cfRes.removeHeader(key);
            val.forEach((v) => cfRes.headers.append(key, v));
          } else {
            cfRes.setHeader(key, val);
          }
        });
      } else if (value !== undefined) {
        if (Array.isArray(value)) {
          // Replace semantics: discard any prior value, then append each item.
          cfRes.removeHeader(field);
          value.forEach((v) => cfRes.headers.append(field, v));
        } else {
          cfRes.setHeader(field, value);
        }
      }
      return this;
    },

    header(
      field: string,
      value?: string | string[],
    ): string | string[] | undefined | ExpressCompatResponse {
      if (value === undefined) {
        return this.get(field);
      }
      return this.set(field, value);
    },

    get(field: string) {
      if (field.toLowerCase() === 'set-cookie') {
        // Express returns Set-Cookie as string[]; never comma-join it.
        const cookies = cfRes.getSetCookie();
        return cookies.length > 0
          ? (cookies as unknown as string)
          : (undefined as unknown as string);
      }
      return cfRes.getHeader(field) || undefined;
    },

    // Node http.ServerResponse-style header methods. Middleware such as
    // helmet call these directly rather than the Express `set`/`get` helpers.
    setHeader(field: string, value: string | number | string[]) {
      if (Array.isArray(value)) {
        // Node's setHeader has REPLACE semantics: a second setHeader() with an
        // array must discard the previous list, not append onto it.
        cfRes.removeHeader(field);
        value.forEach((v) => cfRes.headers.append(field, v));
      } else {
        cfRes.setHeader(field, String(value));
      }
    },

    getHeader(field: string) {
      if (field.toLowerCase() === 'set-cookie') {
        // Node/Express return Set-Cookie as string[]. Set-Cookie values contain
        // commas (Expires=Wed, 01 ...), so a comma-joined string is unparseable.
        const cookies = cfRes.getSetCookie();
        return cookies.length > 0 ? cookies : undefined;
      }
      return cfRes.getHeader(field) ?? undefined;
    },

    removeHeader(field: string) {
      cfRes.removeHeader(field);
    },

    append(field: string, value: string | string[]) {
      if (Array.isArray(value)) {
        value.forEach((v) => cfRes.headers.append(field, v));
      } else {
        cfRes.headers.append(field, value);
      }
      return this;
    },

    send(body?: unknown) {
      if (body === undefined) {
        cfRes.end();
      } else if (typeof body === 'string') {
        if (!cfRes.getHeader('Content-Type')) {
          cfRes.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        cfRes.send(body);
      } else if (Buffer.isBuffer(body)) {
        if (!cfRes.getHeader('Content-Type')) {
          cfRes.setHeader('Content-Type', 'application/octet-stream');
        }
        // eslint-disable-next-line no-undef
        cfRes.send(body as unknown as BodyInit);
      } else if (typeof body === 'object') {
        return this.json(body);
      } else {
        cfRes.send(String(body));
      }
      return this;
    },

    json(body?: unknown) {
      cfRes.json(body);
      return this;
    },

    jsonp(body?: unknown) {
      // For JSONP we would wrap in a callback; send as JSON for now.
      cfRes.json(body);
      return this;
    },

    end(data?: unknown) {
      if (data !== undefined) {
        cfRes.end(typeof data === 'string' ? data : JSON.stringify(data));
      } else {
        cfRes.end();
      }
      return this;
    },

    redirect(statusOrUrl: number | string, url?: string) {
      if (typeof statusOrUrl === 'number' && url) {
        cfRes.redirect(url, statusOrUrl);
      } else if (typeof statusOrUrl === 'string') {
        cfRes.redirect(statusOrUrl, 302);
      }
    },

    type(type: string) {
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        json: 'application/json',
        xml: 'application/xml',
        text: 'text/plain',
        js: 'application/javascript',
        css: 'text/css',
      };
      const contentType = mimeTypes[type] || type;
      cfRes.setHeader('Content-Type', contentType);
      return this;
    },

    contentType(type: string) {
      return this.type(type);
    },

    cookie(name: string, value: string, options: CookieOptions = {}) {
      const cookieStr = serializeCookie(name, value, options);
      cookies.push(cookieStr);
      cfRes.headers.append('Set-Cookie', cookieStr);
      return this;
    },

    clearCookie(name: string, options: CookieOptions = {}) {
      const clearOptions = { ...options, expires: new Date(0), maxAge: 0 };
      return this.cookie(name, '', clearOptions);
    },

    location(url: string) {
      cfRes.setHeader('Location', url);
      return this;
    },

    links(links: Record<string, string>) {
      const linkHeader = Object.entries(links)
        .map(([rel, href]) => `<${href}>; rel="${rel}"`)
        .join(', ');
      cfRes.setHeader('Link', linkHeader);
      return this;
    },

    vary(field: string) {
      const existing = cfRes.getHeader('Vary');
      if (existing) {
        cfRes.setHeader('Vary', `${existing}, ${field}`);
      } else {
        cfRes.setHeader('Vary', field);
      }
      return this;
    },

    format(obj: Record<string, () => void>) {
      const accept = cfRes.headers.get?.('Accept') || '*/*';
      const types = Object.keys(obj);
      const matched = parseAccept(accept, types);

      if (matched && obj[matched]) {
        obj[matched]();
      } else if (obj.default) {
        obj.default();
      }
      return this;
    },
  };

  return res;
}

/**
 * A wrapped Express middleware as the adapter's middleware chain runs it.
 *
 * The chain-level `next` may carry an error so that a normal middleware's
 * `next(err)` can be routed forward to a downstream 4-arg error handler rather
 * than aborting the whole chain. The wrapped function therefore accepts an
 * optional incoming `err`, and is tagged with {@link isExpressErrorMiddleware}
 * so the chain knows whether to feed it the propagated error.
 */
export type WrappedExpressMiddleware = ((
  req: CloudflareRequest,
  res: CloudflareResponse,
  next: (err?: unknown) => void,
  err?: unknown,
) => Promise<void>) & {
  /** Whether the wrapped middleware is a 4-argument error handler. */
  readonly isExpressErrorMiddleware: boolean;
};

/**
 * Wrap an Express middleware to work with the Cloudflare adapter.
 *
 * Normal (3-arg) middleware run on every pass; if they call `next(err)` the
 * error is forwarded down the chain (the chain locates the next 4-arg error
 * handler). 4-arg error-handling middleware are skipped on the normal path and
 * only run when an error reaches them, receiving the propagated error.
 *
 * @param middleware The Express middleware (3-arg) or error handler (4-arg).
 * @returns A wrapped function the adapter's middleware chain can invoke.
 */
export function wrapExpressMiddleware(
  middleware: ExpressMiddleware | ExpressErrorMiddleware,
): WrappedExpressMiddleware {
  const isErrorMiddleware = middleware.length >= 4;

  const wrapped = async (
    cfReq: CloudflareRequest,
    cfRes: CloudflareResponse,
    next: (err?: unknown) => void,
    incomingErr?: unknown,
  ): Promise<void> => {
    const expressReq = createExpressRequest(cfReq);
    const expressRes = createExpressResponse(cfRes);

    return new Promise<void>((resolve) => {
      const expressNext: ExpressNextFunction = (err?: unknown) => {
        // Always forward (with or without an error) to the chain; the chain
        // decides whether a downstream error handler exists. resolve() here so
        // this wrapper's promise settles once control has passed on.
        next(err);
        resolve();
      };

      // 4-arg error-handling middleware: only run when an error reached us.
      if (isErrorMiddleware) {
        if (incomingErr === undefined) {
          // Normal path: skip the error handler and advance the chain.
          next();
          resolve();
          return;
        }
        try {
          const result = (middleware as ExpressErrorMiddleware)(
            incomingErr,
            expressReq,
            expressRes,
            expressNext,
          );
          if (result instanceof Promise) {
            result
              .then(() => {
                // The handler responded (or returned without calling next):
                // settle the wrapper so the chain can finish.
                if (cfRes.sent) {
                  resolve();
                }
              })
              // A throw/reject from an error handler is itself an error in
              // flight: forward it down the chain (Express routes it to the
              // next error handler) instead of rejecting the wrapper.
              .catch((e) => {
                next(e);
                resolve();
              });
          } else if (cfRes.sent) {
            resolve();
          }
        } catch (e) {
          next(e);
          resolve();
        }
        return;
      }

      try {
        const result = (middleware as ExpressMiddleware)(
          expressReq,
          expressRes,
          expressNext,
        );
        if (result instanceof Promise) {
          result
            .then(() => {
              if (cfRes.sent) resolve();
            })
            // In real Express, a thrown/rejected error from a normal (3-arg)
            // middleware is equivalent to next(err): forward it so the chain
            // advances to the next downstream error handler, instead of
            // rejecting the wrapper (which would skip straight to the
            // catch-all 500).
            .catch((err) => {
              next(err);
              resolve();
            });
        } else if (cfRes.sent) {
          resolve();
        }
      } catch (err) {
        next(err);
        resolve();
      }
    });
  };

  return Object.assign(wrapped, {
    isExpressErrorMiddleware: isErrorMiddleware,
  }) as WrappedExpressMiddleware;
}

/**
 * Minimal Express-like application object for middleware that registers itself
 * via `app.use()` (or the HTTP verb methods) rather than being passed inline.
 * Returned by {@link CloudflareAdapter.getExpressApp}.
 */
export interface ExpressLikeApp {
  /** Mount middleware globally or under a path prefix. */
  use: (...args: unknown[]) => void;
  /** Register a `GET` route. */
  get: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a `POST` route. */
  post: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a `PUT` route. */
  put: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a `DELETE` route. */
  delete: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a `PATCH` route. */
  patch: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register an `OPTIONS` route. */
  options: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a `HEAD` route. */
  head: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Register a route for every supported HTTP verb. */
  all: (path: string, ...handlers: ExpressMiddleware[]) => void;
  /** Application-local variables some middleware read or write. */
  locals: Record<string, unknown>;
  /** Application settings store backing `set`/`get`/`enable`/`disable`. */
  settings: Record<string, unknown>;
  /** Set an application setting. */
  set: (key: string, value: unknown) => void;
  /** Enable a boolean setting. */
  enable: (key: string) => void;
  /** Disable a boolean setting. */
  disable: (key: string) => void;
  /** Whether a setting is enabled. */
  enabled: (key: string) => boolean;
  /** Whether a setting is disabled. */
  disabled: (key: string) => boolean;
}
