# gym-payments-service

Baseline Express scaffold that owns charging and refunding payments for members of `gym-membership-service`. Kept as a separate service so membership logic and payment logic can evolve independently, matching the cross-service pattern used elsewhere in this workspace (e.g. Restaurant Catalog service / Order & Delivery service).

## Domain model

- **Payment** — memberId (reference to a member in `gym-membership-service`, no local foreign key), type (`CHARGE` / `REFUND`), amount, status (`SUCCESS` / `FAILED` / `PENDING`, defaults to `SUCCESS`), reason (optional), relatedPaymentId (optional — links a refund back to the charge it reverses)

## Stack

- Express 4
- Sequelize + SQLite for local dev (swap the dialect in `src/config/database.js` for Postgres/MySQL in other environments)
- helmet, cors, morgan for baseline hardening/logging

## Project structure

Same layering as `gym-membership-service`: `config/models/services/controllers/routes/middleware`.

## Run

```
cp .env.example .env
npm install
npm run dev
```

Listens on `http://localhost:3001` (configurable via `PORT`) so it can run alongside `gym-membership-service` (port 3000) during local testing.

## Endpoints

- `GET /api/health` — liveness check
- `POST /api/payments/charge` — `{ "memberId", "amount", "reason", "status" }` — records a charge; `status` is optional and defaults to `SUCCESS`, but may be any of `SUCCESS` / `FAILED` / `PENDING` so a declined charge can be recorded (anything else is a `400`)
- `POST /api/payments/refund` — `{ "memberId", "amount", "reason", "relatedPaymentId" }` — records a refund; if `relatedPaymentId` is given it must reference an existing `CHARGE` for that same member, or `422`
- `GET /api/payments/member/:memberId` — full payment history for a member, most recent first
- `GET /api/payments/:id` — get one payment (`404` if missing)

## Relationship to gym-membership-service

This service doesn't know about classes, bookings, or trainers — only payments against a `memberId`. `gym-membership-service` is expected to call into this service when a member renews or cancels, per tickets `FIT-5`/`FIT-6`/`FIT-7`.
