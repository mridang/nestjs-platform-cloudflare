import 'reflect-metadata';
import 'urlpattern-polyfill';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  Module,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CloudflareAdapter } from '../../src/index.js';

@Controller()
class AppController {
  @Get('/ping')
  ping(): { pong: true } {
    return { pong: true };
  }

  @Get('/users/:id')
  user(@Param('id') id: string): { id: string } {
    return { id };
  }

  @Post('/echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Post('/no-content')
  @HttpCode(204)
  noContent(): { ignored: true } {
    return { ignored: true };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

describe('CloudflareAdapter (e2e via Nest)', () => {
  let app: INestApplication;
  let adapter: CloudflareAdapter;

  beforeAll(async () => {
    adapter = new CloudflareAdapter();
    app = await NestFactory.create(AppModule, adapter, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a GET controller route', async () => {
    const res = await adapter.handle(new Request('https://w.test/ping'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  it('binds route params', async () => {
    const res = await adapter.handle(new Request('https://w.test/users/99'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: '99' });
  });

  it('parses and echoes a JSON POST body', async () => {
    const res = await adapter.handle(
      new Request('https://w.test/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('serves a HEAD request from a @Get() controller route', async () => {
    const res = await adapter.handle(
      new Request('https://w.test/ping', { method: 'HEAD' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('produces a valid 204 with a null body for @HttpCode(204)', async () => {
    const res = await adapter.handle(
      new Request('https://w.test/no-content', { method: 'POST' }),
    );
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await adapter.handle(new Request('https://w.test/nope'));
    expect(res.status).toBe(404);
  });
});
