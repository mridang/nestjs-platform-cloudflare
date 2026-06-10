import type { INestApplication } from '@nestjs/common';
import type {
  CloudflareHttpServer,
  CloudflareCorsOptions,
  CloudflareStaticAssetsOptions,
} from './cloudflare-http-options.interface.js';
import type {
  CloudflareRequest,
  CloudflareResponse,
} from '../adapters/cloudflare-adapter.js';

/**
 * Interface for a NestJS application running on the Cloudflare adapter.
 */
export interface NestCloudflareApplication extends INestApplication {
  /**
   * Get the underlying Cloudflare HTTP server handle.
   */
  getHttpServer(): CloudflareHttpServer | undefined;

  /**
   * Enable CORS for the application.
   * @param options CORS configuration options.
   */
  enableCors(options?: CloudflareCorsOptions): this;

  /**
   * Register static assets. On Workers this is a no-op; static files are
   * served by the platform's `assets` binding.
   * @param path Path to the static assets directory.
   * @param options Static assets options.
   */
  useStaticAssets(path: string, options?: CloudflareStaticAssetsOptions): this;

  /**
   * Set a custom error handler.
   * @param handler Error handler function.
   */
  setErrorHandler(
    handler: (
      error: Error,
      req: CloudflareRequest,
      res: CloudflareResponse,
    ) => void,
  ): this;

  /**
   * Set a custom 404 handler.
   * @param handler Not found handler function.
   */
  setNotFoundHandler(
    handler: (req: CloudflareRequest, res: CloudflareResponse) => void,
  ): this;

  /**
   * The public Worker entry point: route a Web `Request` through Nest and
   * obtain a Web `Response`.
   * @param request The incoming Web `Request`.
   */
  handle(request: Request): Promise<Response>;
}
