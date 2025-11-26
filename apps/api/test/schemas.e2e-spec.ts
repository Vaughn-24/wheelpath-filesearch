import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Schemas E2E', () => {
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

  it('GET /schemas/rfi returns the RFI schema', async () => {
    const res = await request(app.getHttpServer()).get('/schemas/rfi').expect(200);
    expect(res.body.title).toBe('RequestForInformation');
    expect(res.body.properties.docType.const).toBe('rfi');
  });
});
