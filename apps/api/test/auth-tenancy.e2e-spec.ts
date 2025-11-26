import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { AppModule } from '../src/app.module';

const JWT_SECRET = 'test-secret';

function signToken(payload: Record<string, any>) {
  return jwt.sign(payload, JWT_SECRET, {
    issuer: 'wheelpath-tests',
    audience: 'wheelpath-api',
    algorithm: 'HS256',
  });
}

describe('Auth & Tenancy E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_ISSUER = 'wheelpath-tests';
    process.env.JWT_AUDIENCE = 'wheelpath-api';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects when no token', async () => {
    await request(app.getHttpServer()).get('/documents').expect(401);
  });

  it('allows same-tenant access and blocks cross-tenant', async () => {
    const tokenA = signToken({ sub: 'user-a1', tenantId: 'tenant-a', email: 'a1@t.local' });
    const tokenB = signToken({ sub: 'user-b1', tenantId: 'tenant-b', email: 'b1@t.local' });

    const resA = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(resA.body)).toBe(true);
    expect(resA.body.every((d: any) => d.tenantId === 'tenant-a')).toBe(true);

    const resB = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body.every((d: any) => d.tenantId === 'tenant-b')).toBe(true);

    const cross = await request(app.getHttpServer())
      .get('/documents/a1')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    // Not found for cross-tenant
    expect(cross.body).toEqual({ error: 'Not found' });
  });
});
