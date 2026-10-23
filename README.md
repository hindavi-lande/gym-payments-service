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
- `POST /api/payments/charge` — `{ "memberId", "amount", "reason", "simulateDecline" }` — records a successful charge. `simulateDecline: true` makes the charge fail with `402` and writes no payment row; this flag is a temporary stand-in for an issuer/gateway decision (there is no gateway integration yet) and will be removed once a real gateway is wired in. Callers that omit it behave exactly as before.
- `POST /api/payments/refund` — `{ "memberId", "amount", "reason", "relatedPaymentId", "status", "simulatePending" }` — records a `REFUND` row linked to the charge it gives money back from. When `relatedPaymentId` is given it must reference an existing `CHARGE` for that same member, or `422`; the refund amount may not exceed that charge's amount, or `422`; and a charge that already has a `SUCCESS` or `PENDING` refund cannot be refunded again, or `409` with a message naming that payment — a `FAILED` refund does not block a retry because no money moved. `status` may be `SUCCESS` (the default — the "completed" outcome callers see), `PENDING` or `FAILED`. `simulatePending: true` forces `PENDING` and, like `simulateDecline`, is a temporary stand-in for a gateway decision that will be removed once a real gateway is wired in.
- `GET /api/payments/member/:memberId` — full payment history for a member, most recent first
- `PATCH /api/payments/:id/status` — `{ "status": "SUCCESS" | "FAILED" }` — settles a refund recorded as `PENDING` to its final outcome, so the member's payment history shows what happened to it. `404` for an unknown payment id, `422` for a status other than `SUCCESS` or `FAILED`, and `409` when the payment is not a `REFUND` or is no longer `PENDING`. A settled refund keeps its `relatedPaymentId`, so it stays linked to the charge it reverses. Like every endpoint in this service there is no auth on it; the intended caller is a staff-facing gateway/admin caller whenever it resolves a pending refund.
- `GET /api/payments/:id` — get one payment (`404` if missing)

## Relationship to gym-membership-service

This service doesn't know about classes, bookings, or trainers — only payments against a `memberId`. `gym-membership-service` is expected to call into this service when a member renews or cancels, per tickets `FIT-5`/`FIT-6`/`FIT-7`.
