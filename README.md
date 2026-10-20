# nest-notification-hub

Notification delivery service built with **NestJS**, **BullMQ** (Redis) and **PostgreSQL**.

Clients send a notification request once; the service stores it, queues it, and delivers it
asynchronously through a channel (webhook, email, WhatsApp sandbox), retrying with exponential
backoff and parking messages that keep failing in a dead-letter queue.

> Status: work in progress. This README tracks what is already implemented.

## Why this project

Delivering messages to third parties is a classic source of production incidents: slow providers,
timeouts, duplicated sends after a retry. This repo is a small, readable reference for the patterns
that handle that:

- idempotent API (`Idempotency-Key`) so a client retry never creates a duplicate
- queue + workers to decouple the HTTP request from the slow delivery
- retries with exponential backoff, and a dead-letter queue for poison messages
- delivery attempts persisted for auditing
- health checks and metrics

## Development workflow

- `main` is protected: changes land through pull requests.
- CI runs on every PR: lint, formatting, typecheck, unit tests with coverage, build,
  [Conventional Commits](https://www.conventionalcommits.org/) on every commit and on the PR title.
- Husky runs commitlint and the fast checks locally before each commit.

## Getting started

```bash
npm ci
npm run start:dev   # http://localhost:3000/health
npm test
```

## License

MIT
