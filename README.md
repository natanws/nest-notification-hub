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

## API

### `POST /notifications`

Requires an `Idempotency-Key` header (8-128 chars). The recipient format depends on the channel:
`WEBHOOK` takes an http(s) URL, `EMAIL` an e-mail address, `WHATSAPP` an E.164 phone number.

```bash
curl -i localhost:3000/notifications   -H 'Content-Type: application/json'   -H 'Idempotency-Key: order-42-paid'   -d '{"channel":"WEBHOOK","recipient":"https://example.com/hooks","payload":{"orderId":42}}'
```

| Situation | Response |
| --- | --- |
| New key | `202 Accepted` + the notification (`status: PENDING`) |
| Same key, same body (client retry) | `200 OK` + the same notification, nothing duplicated |
| Same key, different body | `409 Conflict` |
| Missing/invalid header, wrong recipient format, unknown fields | `400 Bad Request` |

The body is hashed with keys sorted at every level, so `{"a":1,"b":2}` and `{"b":2,"a":1}` count as
the same request. Concurrent requests with the same key are settled by a unique index: one insert
wins and the others return the winner (covered by an e2e test that fires 5 requests at once).

### `GET /notifications/:id` and `GET /notifications/:id/attempts`

Current state of a notification and its delivery attempt log.

## Development workflow

- `main` is protected: changes land through pull requests.
- CI runs on every PR: lint, formatting, typecheck, unit tests with coverage, build,
  [Conventional Commits](https://www.conventionalcommits.org/) on every commit and on the PR title.
- Husky runs commitlint and the fast checks locally before each commit.

## Getting started

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL
npm ci
npx prisma migrate deploy
npm run start:dev           # http://localhost:3000/health
npm test                    # unit tests
npm run test:e2e            # API tests against the real database
```

## License

MIT
