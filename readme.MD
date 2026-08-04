# Ticketing

An event-driven microservices ticketing platform. Sellers list tickets; buyers reserve and pay for them. Services communicate over HTTP (via an NGINX Ingress gateway) and asynchronously through NATS Streaming.

## Overview

- **Sellers** create and update ticket listings.
- **Buyers** browse tickets, place orders (15-minute time-limited reservations), and pay with Stripe.
- Each business domain is its own service with its own database.
- Cross-service consistency is handled with domain events and optimistic concurrency control (not shared DB joins).

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
| **client** | Next.js UI (Pages Router) | `/` | — | No (HTTP to APIs) |
| **common** | Shared errors, middlewares, event contracts | — | — | — |

Supporting infra:

| Component | Purpose |
|-----------|---------|
| **nats-depl** | NATS Streaming server (event bus) |
| **\*-mongo-depl** | Dedicated MongoDB per service |
| **expiration-redis-depl** | Redis for Bull delay queues |
| **ingress-srv** | Path-based routing to services |

## API Routes

### Auth Service (`/api/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/users/signup` | No | Register user, set JWT session |
| POST | `/api/users/signin` | No | Login, set JWT session |
| POST | `/api/users/signout` | No | Clear session |
| GET | `/api/users/currentuser` | Optional | Return current user from JWT |

### Tickets Service (`/api/tickets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tickets` | No | List all tickets |
| GET | `/api/tickets/:id` | No | Show single ticket |
| POST | `/api/tickets` | Yes | Create ticket |
| PUT | `/api/tickets/:id` | Yes | Update ticket |

### Orders Service (`/api/orders`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orders` | Yes | List current user's orders |
| GET | `/api/orders/:orderId` | Yes | Show single order |
| POST | `/api/orders` | Yes | Create order (15-min expiration) |
| DELETE | `/api/orders/:orderId` | Yes | Cancel order |

### Payments Service (`/api/payments`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/payments` | Yes | Charge via Stripe, record payment |

## Event-Driven Communication

### Sync vs async

- **Synchronous (HTTP):** Browser / Next.js SSR → Ingress → service.
- **Asynchronous (NATS):** Domain events between tickets, orders, payments, and expiration.

### NATS subjects

| Subject | Publisher | Listeners |
|---------|-----------|-----------|
| `ticket:created` | tickets | orders |
| `ticket:updated` | tickets | orders |
| `order:created` | orders | tickets, expiration, payments |
| `order:cancelled` | orders | tickets, payments |
| `expiration:complete` | expiration | orders |
| `payment:created` | payments | orders |

### Event flow (purchase lifecycle)

```text
1. tickets  --ticket:created/updated-->  orders (replicate ticket)
2. orders   --order:created------------>  tickets (reserve ticket)
                                      ->  expiration (schedule delay job)
                                      ->  payments (replicate order)
3. expiration (after 15-min delay)
            --expiration:complete------>  orders (cancel if unpaid)
4. orders   --order:cancelled---------->  tickets (release ticket)
                                      ->  payments (update status)
5. payments --payment:created---------->  orders (mark complete)
```

### Order statuses

Defined in shared `OrderStatus` enum:

| Status | Meaning |
|--------|---------|
| `created` | Order created; reservation in progress |
| `cancelled` | Cancelled, expired, or ticket unavailable |
| `awaiting:payment` | Ticket reserved; waiting for payment |
| `complete` | Payment succeeded |

## Data Models

### Auth

| Model | Fields |
|-------|--------|
| `User` | `email`, `password` (scrypt hashed on save) |

### Tickets

| Model | Fields |
|-------|--------|
| `Ticket` | `title`, `price`, `userId`, `orderId?`, `version` |

### Orders

| Model | Fields |
|-------|--------|
| `Ticket` (local replica) | `title`, `price`, `version` + `isReserved()` method |
| `Order` | `userId`, `status`, `expiresAt`, `ticket` (ref), `version` |

### Payments

| Model | Fields |
|-------|--------|
| `Order` (local replica) | `userId`, `price`, `status`, `version` |
| `Payment` | `orderId`, `stripeId` |

## Auth Model

- JWT stored in a cookie session (`cookie-session`, unsigned, not encrypted).
- `currentUser` / `requireAuth` middlewares from `@kumar-chaitanya/common-ticketing-service`.
- Services trust the JWT via a shared `JWT_KEY` Kubernetes secret.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Services | Node.js 20, TypeScript, Express |
| Frontend | Next.js 14 (Pages Router), Bootstrap, react-stripe-checkout |
| Data | MongoDB (Mongoose), Redis (Bull) |
| Events | NATS Streaming |
| Payments | Stripe |
| Shared code | `@kumar-chaitanya/common-ticketing-service` (npm) |
| Containers | Docker (node:20-alpine) |
| Orchestration | Kubernetes + Skaffold |
| Ingress | NGINX Ingress Controller |

## Project Structure

```text
ticketing/
├── auth/                 # Auth service
│   └── src/
│       ├── models/       # User model
│       ├── routes/       # signup, signin, signout, current-user
│       ├── services/     # Password hashing (scrypt)
│       └── test/         # Jest setup + route tests
├── tickets/              # Ticket listings service
│   └── src/
│       ├── models/       # Ticket model
│       ├── routes/       # CRUD endpoints
│       └── events/       # Publishers + Listeners
├── orders/               # Orders / reservations service
│   └── src/
│       ├── models/       # Order + Ticket (replica) models
│       ├── routes/       # CRUD endpoints
│       └── events/       # Publishers + Listeners
├── payments/             # Stripe payments service
│   └── src/
│       ├── models/       # Order (replica) + Payment models
│       ├── routes/       # POST /api/payments
│       └── events/       # Publishers + Listeners
├── expiration/           # Order expiration worker (no HTTP)
│   └── src/
│       ├── queues/       # Bull queue definition
│       └── events/       # Listeners + Publishers
├── client/               # Next.js frontend
│   ├── pages/            # signup, signin, signout, tickets, orders
│   ├── components/       # Header nav
│   ├── hooks/            # use-request (axios wrapper)
│   └── api/              # build-client (SSR axios helper)
├── common/               # Shared library (published to npm)
│   └── src/
│       ├── errors/       # Custom error classes
│       ├── middlewares/  # currentUser, requireAuth, errorHandler, validateRequest
│       └── events/       # BaseListener, BasePublisher, event interfaces, Subjects enum
├── nats-test/            # Local NATS pub/sub experiments
├── infra/k8s/            # Kubernetes manifests (13 files)
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

## Getting Started

### Prerequisites

- Docker Desktop with Kubernetes enabled
- [Skaffold](https://skaffold.dev/)
- NGINX Ingress Controller (`kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml`)
- Hosts entry for the ingress host:

```text
127.0.0.1 ticketing.dev
```

### Secrets

Create required secrets before running (names must match the deployments):

```bash
kubectl create secret generic jwt-secret --from-literal=JWT_KEY=your_jwt_key
kubectl create secret generic stripe-secret --from-literal=STRIPE_KEY=sk_test_your_stripe_secret_key
```

### Run Locally

```bash
skaffold dev
```

Skaffold builds all 6 Docker images, applies `infra/k8s/*`, and file-syncs TypeScript/JS into running pods for live reloading.

Open: `https://ticketing.dev`

### Docker Images

| Image | Service |
|-------|---------|
| `chaitanyadocker1/auth` | Auth |
| `chaitanyadocker1/tickets` | Tickets |
| `chaitanyadocker1/orders` | Orders |
| `chaitanyadocker1/payments` | Payments |
| `chaitanyadocker1/expiration` | Expiration |
| `chaitanyadocker1/ticketing-client` | Client |

## Testing

Each service uses Jest with `mongodb-memory-server` and mocked NATS client:

```bash
cd auth      && npm test
cd tickets   && npm test
cd orders    && npm test
cd payments  && npm test
```

## Useful Debugging Commands

```bash
kubectl get pods                            # Check pod status and restarts
kubectl logs deploy/auth-depl               # View service logs
kubectl logs deploy/payments-depl           # View payment logs
kubectl describe pod <pod-name>             # Detailed pod info

# Test a service endpoint from inside the cluster
kubectl exec deploy/auth-depl -- wget -qO- http://localhost:3000/api/users/currentuser

# Check MongoDB data
kubectl exec deploy/auth-mongo-depl -- mongosh auth --quiet --eval "db.users.find().toArray()"
```

## Notes

- Databases are **not shared** across services; read models are updated via events with optimistic concurrency (`mongoose-update-if-current` version fields).
- `expiration` has no Ingress route; it only consumes/produces NATS events and uses Redis + Bull for delayed jobs.
- Shared types, errors, middlewares, and event definitions live in `common/` and are consumed as `@kumar-chaitanya/common-ticketing-service` from npm.
- MongoDB pods use ephemeral storage — data is lost on pod restart. For persistence, add `PersistentVolumeClaim` to the mongo deployments.
- The Stripe publishable key is configured in `client/pages/orders/[orderId].js`. The secret key is stored as a Kubernetes secret.
