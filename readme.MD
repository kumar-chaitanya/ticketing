# Ticketing

An event-driven microservices ticketing platform. Sellers list tickets; buyers reserve and pay for them. Services communicate over HTTP (via an API gateway) and asynchronously through NATS Streaming.

## Overview

- **Sellers** create and update ticket listings.
- **Buyers** browse tickets, place orders (time-limited reservations), and pay with Stripe.
- Each business domain is its own service with its own database.
- Cross-service consistency is handled with domain events (not shared DB joins).

## Architecture

### High-level system

```text
                         Browser
                            |
                            v
                   https://ticketing.dev
                            |
                    NGINX Ingress Controller
                            |
        +---------+---------+---------+---------+
        |         |         |         |         |
        v         v         v         v         v
   /api/users /api/tickets /api/orders /api/payments  /?(.*)
     auth       tickets      orders      payments     client
      |           |            |            |           |
      v           v            v            v           v
  auth-mongo tickets-mongo orders-mongo payments-mongo Next.js
                  \            |            /
                   \           |           /
                    \          v          /
                     \--> NATS Streaming <--/
                               |
                               v
                          expiration
                               |
                               v
                       expiration-redis
```

### Services

| Service | Role | API prefix | Datastore | NATS |
|---------|------|------------|-----------|------|
| **auth** | Signup, signin, signout, current user (JWT in cookie session) | `/api/users` | MongoDB | No |
| **tickets** | CRUD ticket listings; reserve/release via order events | `/api/tickets` | MongoDB | Yes |
| **orders** | Create/cancel/list orders; 15-minute reservation window | `/api/orders` | MongoDB | Yes |
| **payments** | Charge Stripe; record payments | `/api/payments` | MongoDB | Yes |
| **expiration** | Delayed job per order; emits `expiration:complete` | *(none)* | Redis (Bull) | Yes |
| **client** | Next.js UI | `/` | — | No (HTTP to APIs) |
| **common** | Shared errors, middlewares, event contracts (`@sgticketing/common`) | — | — | — |

Supporting infra:

| Component | Purpose |
|-----------|---------|
| **nats-depl** | NATS Streaming server (event bus) |
| **\*-mongo-depl** | Dedicated MongoDB per service |
| **expiration-redis-depl** | Redis for Bull delay queues |
| **ingress-srv** | Path-based routing to services |

### Sync vs async communication

- **Synchronous (HTTP):** Browser / Next.js SSR → Ingress → service.
- **Asynchronous (NATS):** Domain events between tickets, orders, payments, and expiration.

### Event flow (purchase lifecycle)

```text
1. tickets  --ticket:created/updated-->  orders
2. orders   --order:created------------>  tickets (reserve)
                                      ->  expiration (schedule job)
                                      ->  payments (load order)
3. expiration (after delay)
            --expiration:complete------>  orders (cancel if unpaid)
4. orders   --order:cancelled---------->  tickets (release)
                                      ->  payments
5. payments --payment:created---------->  orders (mark complete)
```

### NATS subjects

| Subject | Publisher | Typical listeners |
|---------|-----------|-------------------|
| `ticket:created` | tickets | orders |
| `ticket:updated` | tickets | orders |
| `order:created` | orders | tickets, expiration, payments |
| `order:cancelled` | orders | tickets, payments |
| `expiration:complete` | expiration | orders |
| `payment:created` | payments | orders |

### Order statuses

Defined in shared `OrderStatus`:

| Status | Meaning |
|--------|---------|
| `created` | Order created; reservation in progress |
| `cancelled` | Cancelled, expired, or ticket unavailable |
| `awaiting:payment` | Ticket reserved; waiting for payment |
| `complete` | Payment succeeded |

### Auth model

- JWT stored in a cookie session (`cookie-session`).
- `currentUser` / `requireAuth` middlewares from `@sgticketing/common`.
- Services trust the JWT via a shared `JWT_KEY` Kubernetes secret.

## Tech stack

| Layer | Technology |
|-------|------------|
| Services | Node.js, TypeScript, Express |
| Frontend | Next.js |
| Data | MongoDB (Mongoose), Redis (Bull) |
| Events | NATS Streaming |
| Payments | Stripe |
| Shared code | `@sgticketing/common` npm package |
| Containers | Docker |
| Orchestration | Kubernetes + Skaffold |
| Ingress | NGINX Ingress Controller |

## Project structure

```text
ticketing/
├── auth/                 # Auth service
├── tickets/              # Ticket listings service
├── orders/               # Orders / reservations service
├── payments/             # Stripe payments service
├── expiration/           # Order expiration worker
├── client/               # Next.js frontend
├── common/               # Shared library (published to npm)
├── nats-test/            # Local NATS pub/sub experiments
├── infra/k8s/            # Kubernetes manifests
│   ├── ingress-srv.yaml
│   ├── nats-depl.yaml
│   ├── auth-depl.yaml / auth-mongo-depl.yaml
│   ├── tickets-depl.yaml / tickets-mongo-depl.yaml
│   ├── orders-depl.yaml / orders-mongo-depl.yaml
│   ├── payments-depl.yaml / payments-mongo-depl.yaml
│   ├── expiration-depl.yaml / expiration-redis-depl.yaml
│   └── client-depl.yaml
├── skaffold.yaml
└── readme.MD
```

## API routes (Ingress)

| Path | Service |
|------|---------|
| `/api/users/*` | auth |
| `/api/tickets/*` | tickets |
| `/api/orders/*` | orders |
| `/api/payments/*` | payments |
| `/*` | client |

## Getting started

### Prerequisites

- Docker Desktop with Kubernetes enabled
- Skaffold
- NGINX Ingress Controller
- Hosts entry for the ingress host:

```text
127.0.0.1 ticketing.dev
```

### Secrets

Create required secrets before `skaffold dev` (names must match the deployments):

```bash
kubectl create secret generic jwt-secret --from-literal=JWT_KEY=your_jwt_key
kubectl create secret generic stripe-secret --from-literal=STRIPE_KEY=your_stripe_secret_key
```

### Run locally

```bash
skaffold dev
```

Skaffold builds images, applies `infra/k8s/*`, and file-syncs TypeScript/JS into running pods.

Open: `https://ticketing.dev` (or `http://ticketing.dev` depending on your ingress TLS setup).

### Useful debugging

```bash
kubectl get pods
kubectl logs deploy/auth-depl
kubectl exec deploy/auth-depl -- wget -qO- --timeout=5 http://127.0.0.1:3000/api/users/currentuser
```

## Testing

Each service with Jest:

```bash
cd auth      && npm test
cd tickets   && npm test
cd orders    && npm test
cd payments  && npm test
```

Tests typically use `mongodb-memory-server` and mock the NATS client.

## Notes

- Databases are **not shared** across services; read models are updated via events (with optimistic concurrency / version fields where used).
- `expiration` has no Ingress route; it only consumes/produces NATS events and uses Redis for delayed jobs.
- Shared types and middlewares live in `common` and are consumed as `@sgticketing/common`.
