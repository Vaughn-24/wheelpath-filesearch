import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('App E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'wheelpath-tests';
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'wheelpath-api';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ ok: true });
  });
});
