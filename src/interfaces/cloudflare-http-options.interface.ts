/**
 * Options for configuring the Cloudflare Workers HTTP adapter.
 *
 * Unlike a Node/Deno server, a Worker is invoked by the runtime through a
 * `fetch` export rather than by binding to a port. These options therefore
 * describe behaviour of the adapter (CORS, body parsing, static assets)
 * rather than a listening socket.
 */
export interface CloudflareHttpOptions {
  /**
   * Logical hostname to report for incoming requests when one cannot be
   * derived from the request URL.
   */
  hostname?: string;

  /**
   * Handler invoked when {@link CloudflareAdapter.listen} is called. On
   * Workers there is no socket to bind, so this is purely informational.
   */
  onListen?: (params: { hostname: string; port: number }) => void;
}

/**
 * Represents the "server" handle returned by the Cloudflare adapter.
 *
 * On Workers there is no long-lived server object; the adapter exposes this
 * lightweight shape so that Nest's lifecycle and `getHttpServer()` callers
 * have something concrete to hold onto.
 */
export interface CloudflareHttpServer {
  /**
   * The public entry point. A Worker's `fetch` export should delegate to this:
   * `export default { fetch: (req) => adapter.handle(req) }`.
   */
  handle(request: Request): Promise<Response>;

  /**
   * Promise that resolves when the adapter is closed. Always resolved on
   * Workers since there is nothing to tear down.
   */
  finished: Promise<void>;
}

/**
 * CORS options for the Cloudflare adapter. Mirrors the subset of the Express
 * `cors` options that the adapter understands.
 */
export interface CloudflareCorsOptions {
  /**
   * Allowed origin(s). A string or RegExp (or array of either) is matched
   * against the request `Origin`; a boolean reflects (`true`) or denies
   * (`false`) it; a function resolves the allowed value, supporting both the
   * value-returning and Nest's callback-style (`(origin, cb)`) forms.
   */
  origin?:
    | string
    | RegExp
    | (string | RegExp)[]
    | boolean
    | ((origin: string) => boolean | string)
    | ((
        origin: string,
        callback: (err: Error | null, allow?: boolean | string) => void,
      ) => void);
  /** HTTP methods allowed for cross-origin requests (`Access-Control-Allow-Methods`). */
  methods?: string | string[];
  /** Request headers a client may send (`Access-Control-Allow-Headers`). */
  allowedHeaders?: string | string[];
  /** Response headers exposed to the client (`Access-Control-Expose-Headers`). */
  exposedHeaders?: string | string[];
  /** Whether to set `Access-Control-Allow-Credentials: true`. */
  credentials?: boolean;
  /** Preflight cache lifetime in seconds (`Access-Control-Max-Age`). */
  maxAge?: number;
  /** Accepted for parity; the adapter answers preflight requests directly. */
  preflightContinue?: boolean;
  /** Status code returned for a successful preflight (defaults to 204). */
  optionsSuccessStatus?: number;
}

/**
 * Static assets options.
 *
 * On Cloudflare Workers static files are served by the platform's `assets`
 * binding, not by the adapter, so these options are accepted for API parity
 * but are otherwise advisory. See {@link CloudflareAdapter.useStaticAssets}.
 */
export interface CloudflareStaticAssetsOptions {
  /** URL path prefix under which assets are mounted. */
  prefix?: string;
  /** Index file name to serve for directory requests, or `false` to disable. */
  index?: string | boolean;
  /** Whether to redirect directory requests lacking a trailing slash. */
  redirect?: boolean;
  /** Cache lifetime in milliseconds for served assets. */
  maxAge?: number;
  /** Whether to mark cached assets as immutable. */
  immutable?: boolean;
  /** How to treat dotfiles (`.`-prefixed paths). */
  dotfiles?: 'allow' | 'deny' | 'ignore';
  /** Whether to emit an `ETag` for served assets. */
  etag?: boolean;
  /** Whether to emit a `Last-Modified` header for served assets. */
  lastModified?: boolean;
}

/**
 * Body parser options.
 *
 * Body parsing on the Cloudflare adapter is performed natively against the
 * Web `Request`, so these options are accepted for API parity.
 */
export interface CloudflareBodyParserOptions {
  /** Maximum accepted body size, as a byte count or a size string (e.g. `'1mb'`). */
  limit?: number | string;
  /** Content type(s) this parser should apply to. */
  type?: string | string[];
}
