import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const port = process.env.PORT || 3001;
  console.log(`Starting API on port ${port}...`);
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      'https://wheelpath-web-945257727887.us-central1.run.app',
      'https://wheelpath-web-l2phyyl55q-uc.a.run.app',
      /https:\/\/wheelpath-web-.*\.run\.app$/ // Match any Cloud Run URL for wheelpath-web
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  await app.listen(port, '0.0.0.0'); // Bind to 0.0.0.0 for Docker
  console.log(`Application is running on: ${await app.getUrl()}`);
}

bootstrap();
