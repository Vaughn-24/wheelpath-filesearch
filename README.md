# WheelPath AI Monorepo

[![CI](https://github.com/Vaughn-24/wheelpath2-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Vaughn-24/wheelpath2-ai/actions/workflows/ci.yml)

Monorepo containing API, Web, Workers, and shared packages.

## Workspaces

- apps/api – NestJS API
- apps/web – Next.js web app
- workers/ingestion – Cloud Run job
- workers/indexer – Cloud Run worker
- packages/schemas – JSON Schemas
- packages/types – Generated TS types
- packages/validation – Zod validators
- packages/shared – Shared utilities

## Scripts

- npm run lint – ESLint
- npm run format – Prettier check
- npm run typecheck – TypeScript typecheck
- npm run test – Run workspace tests
- npm run build – Build API and Web
