import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('RFI E2E', () => {
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

  it('rejects invalid RFI with 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/rfi')
      .send({ docType: 'rfi' })
      .expect(422);
    expect(res.body.error).toBeDefined();
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('accepts minimal valid RFI', async () => {
    const payload = {
      tenantId: 'tenant-a',
      projectId: 'p1',
      docType: 'rfi',
      docNumber: '017',
      title: 'Clarify door hardware',
      question: 'Is the door closer required on all entries?',
      status: 'draft',
    };
    const res = await request(app.getHttpServer()).post('/rfi').send(payload).expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe('tenant-a:017');
  });
});
