/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * @module @mridang/nestjs-platform-cloudflare
 *
 * NestJS HTTP adapter for the Cloudflare Workers runtime.
 *
 * This package provides a platform adapter that lets NestJS applications run
 * on the Cloudflare Workers `fetch` model without requiring Express, Fastify,
 * or other Node.js HTTP frameworks. Workers invoke the adapter through a
 * `fetch` export rather than by binding to a port.
 *
 * @example
 * ```ts
 * import { NestFactory } from '@nestjs/core';
 * import { CloudflareAdapter } from '@mridang/nestjs-platform-cloudflare';
 * import { AppModule } from './app.module.js';
 *
 * const adapter = new CloudflareAdapter();
 * const app = await NestFactory.create(AppModule, adapter);
 * await app.init();
 *
 * export default { fetch: (request: Request) => adapter.handle(request) };
 * ```
 *
 * @example Express Middleware Support
 * ```ts
 * import helmet from 'helmet';
 *
 * const adapter = new CloudflareAdapter();
 * adapter.useExpressMiddleware(helmet());
 *
 * const app = await NestFactory.create(AppModule, adapter);
 * await app.init();
 * ```
 */

export {
  CloudflareAdapter,
  FetchAdapter,
} from './adapters/cloudflare-adapter.js';
export type {
  CloudflareRequest,
  CloudflareResponse,
} from './adapters/cloudflare-adapter.js';

export type {
  CloudflareHttpOptions,
  CloudflareHttpServer,
  CloudflareCorsOptions,
  CloudflareStaticAssetsOptions,
  CloudflareBodyParserOptions,
} from './interfaces/cloudflare-http-options.interface.js';

export type { NestCloudflareApplication } from './interfaces/nest-cloudflare-application.interface.js';

export {
  wrapExpressMiddleware,
  createExpressRequest,
  createExpressResponse,
} from './compat/express-compat.js';

export type {
  ExpressCompatRequest,
  ExpressCompatResponse,
  ExpressMiddleware,
  ExpressErrorMiddleware,
  ExpressNextFunction,
  ExpressLikeApp,
  CookieOptions,
  WrappedExpressMiddleware,
} from './compat/express-compat.js';

export {
  wrapFastifyHook,
  wrapFastifyPlugin,
  createFastifyRequest,
  createFastifyReply,
  createFastifyLogger,
} from './compat/fastify-compat.js';

export type {
  FastifyCompatRequest,
  FastifyCompatReply,
  FastifyHook,
  FastifyHookAsync,
  FastifyHookCallback,
  FastifyHookName,
  FastifyDoneCallback,
  FastifyErrorHook,
  FastifyOnSendHook,
  FastifyPlugin,
  FastifyPluginAsync,
  FastifyRouteHandler,
  FastifyRouteOptions,
  FastifyLikeInstance,
  FastifyLogger,
} from './compat/fastify-compat.js';
