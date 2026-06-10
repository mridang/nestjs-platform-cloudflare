# NestJS Platform - Cloudflare

A NestJS HTTP platform adapter that runs NestJS applications natively on
[Cloudflare Workers](https://workers.cloudflare.com/), with no Express, no
`node:http`, and no port.

This adapter implements the NestJS `AbstractHttpAdapter` directly over the
Web Fetch API. It routes an incoming `Request` straight into the Nest
request pipeline and returns a `Response`, so your controllers, providers,
guards, pipes, and interceptors run unchanged. Express and Fastify
middleware are supported through dedicated compatibility layers, so you can
keep using packages like `helmet` and `cookie-parser` without pulling in a
full Node.js HTTP framework.

## Why?

Running NestJS on Cloudflare Workers usually means wrapping the framework in
an emulated Node.js HTTP server (`node:http`) and an Express instance, then
bridging the Worker's `fetch` event into that stack. That works, but it
ships a large emulation layer to every isolate and pays for it on every cold
start.

Workers do not have a long-running server or a port; their entry point is a
single `fetch(request)` handler. This adapter embraces that model instead of
hiding it. The Nest core is platform-agnostic — only the HTTP edge is
Cloudflare-specific — so the adapter is the one place that knows about
Workers, and your application code imports nothing but `@nestjs/*`.

The result is a smaller bundle, a faster cold start, and no Express or
`node:http` shim in the request path, while keeping the parts of the Express
and Fastify ecosystems that are genuinely useful through opt-in
compatibility layers.

## Installation

Install using NPM with the following command:

```sh
npm install --save @mridang/nestjs-platform-cloudflare
```

This package declares `@nestjs/common` and `@nestjs/core` as peer
dependencies, so make sure they are installed in your project.

## Usage

Create the application with the `CloudflareAdapter`, initialise it once, and
export a `fetch` handler that hands each request to the adapter. There is no
`app.listen()` — Workers invoke the `fetch` export directly.

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CloudflareAdapter } from '@mridang/nestjs-platform-cloudflare';
import { AppModule } from './app.module.js';

const adapter = new CloudflareAdapter();
const app = await NestFactory.create(AppModule, adapter, { logger: false });
await app.init();

export default {
  fetch: (request: Request): Promise<Response> => adapter.handle(request),
};
```

Your controllers are ordinary NestJS controllers and need no changes:

```typescript
import { Controller, Get, Post, Body, Param } from '@nestjs/common';

@Controller('widgets')
export class WidgetsController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return { id };
  }

  @Post()
  create(@Body() body: unknown) {
    return { created: body };
  }
}
```

The request body is parsed natively (`application/json`,
`application/x-www-form-urlencoded`, and `multipart/form-data`), the raw
bytes are exposed as a `Buffer` on `request.rawBody` when the application is
created with `{ rawBody: true }`, and the client IP is read from the
`cf-connecting-ip` header for the `@Ip()` decorator.

## Express Middleware

Real Express middleware runs through a compatibility layer that builds an
Express-shaped request and response from the native `Request`. Register
middleware globally or scoped to a path prefix:

```typescript
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

const adapter = new CloudflareAdapter();
adapter.useExpressMiddleware(helmet());
adapter.useExpressMiddleware(cookieParser());
adapter.useExpressMiddleware('/api', compression());
```

Middleware that only reads headers and sets response headers (security
headers, cookies, CORS) works unchanged. Middleware that consumes the
request as a Node.js stream (for example `body-parser` or `multer`) is not
supported — use the adapter's native body parsing and `multipart/form-data`
handling instead.

## Fastify Hooks

Fastify lifecycle hooks are supported through the Fastify compatibility
layer:

```typescript
adapter.useFastifyHook('onRequest', async (request, reply) => {
  reply.header('x-powered-by', 'nestjs-platform-cloudflare');
});
```

## CORS

Enable CORS with the standard NestJS API; preflight `OPTIONS` requests are
answered automatically:

```typescript
const app = await NestFactory.create(AppModule, adapter);
app.enableCors({ origin: 'https://example.com', credentials: true });
```

## Known Issues

- **Static assets:** `useStaticAssets()` is a no-op. Serve static files with
  the Cloudflare Workers
  [static assets](https://developers.cloudflare.com/workers/static-assets/)
  binding instead of the filesystem.
- **View engines:** server-side template rendering (`@Render()`) is not
  supported. Return strings or `Response` objects from controllers instead.
- **Streaming request bodies:** the request body is read once and buffered;
  there is no incremental streaming into the controller.
- **Server-Sent Events and open-ended `@Res()` handlers:** Server-Sent Events
  (`@Sse()`) and handlers that take the raw response via `@Res()` but never
  send a response are not supported. The adapter buffers the response and
  awaits it settling before returning, so a handler that never sends will hang
  rather than stream.

## Useful links

- **[Cloudflare Workers](https://developers.cloudflare.com/workers/):**
  Workers platform documentation.
- **[NestJS](https://docs.nestjs.com/):** NestJS framework documentation.
- **[Custom adapters](https://docs.nestjs.com/faq/http-adapter):** NestJS
  HTTP adapter documentation.

## Contributing

If you have suggestions for how this adapter could be improved, or want to
report a bug, open an issue — we'd love all and any contributions.

## License

Apache License 2.0 © 2024 Mridang Agarwalla
