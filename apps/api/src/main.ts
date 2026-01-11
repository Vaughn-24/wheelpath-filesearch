import 'reflect-metadata';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

// Load environment variables from .env file
config();

async function bootstrap() {
  const port = process.env.PORT || 3001;
  console.log(`Starting API on port ${port}...`);
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      // Cloud Run URLs
      'https://wheelpath-web-945257727887.us-central1.run.app',
      'https://wheelpath-web-l2phyyl55q-uc.a.run.app',
      /https:\/\/wheelpath-web-.*\.run\.app$/,
      // Cloudflare Pages URLs
      'https://wheelpath2-ai.pages.dev',
      'https://wheelpath-ai.pages.dev',
      'https://wheelpath-landing.pages.dev',
      /https:\/\/.*\.wheelpath2-ai\.pages\.dev$/, // Preview deployments
      /https:\/\/.*\.wheelpath-landing\.pages\.dev$/, // Preview deployments
      // Custom domains
      'https://dev.wheelpath.ai',
      'https://wheelpath.ai',
      'https://www.wheelpath.ai',
      // Local development
      'http://localhost:3000',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  await app.listen(port, '0.0.0.0'); // Bind to 0.0.0.0 for Docker
  console.log(`Application is running on: ${await app.getUrl()}`);
}

bootstrap();
