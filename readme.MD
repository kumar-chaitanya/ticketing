# Ticketing

An event-driven microservices ticketing platform. Sellers list tickets; buyers reserve and pay for them. Services communicate over HTTP (via an NGINX Ingress gateway) and asynchronously through NATS Streaming.

This README is also a **revision guide**: architecture, observability, local workflows, and interview-ready concepts.

## Overview

- **Sellers** create and update ticket listings.
- **Buyers** browse tickets, place orders (15-minute time-limited reservations), and pay with Stripe.
- Each business domain is its own service with its own database.
- Cross-service consistency is handled with domain events and optimistic concurrency control (not shared DB joins).
- **Observability:** Prometheus metrics, structured Pino logs → Loki, and OpenTelemetry traces → Tempo, all visualized in Grafana.

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

### Observability (separate namespaces)

```text
default (app)
  auth | tickets | orders | payments | expiration | client
       |  stdout JSON (Pino)     /metrics     OTLP traces
       v                         v            v
┌────────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐
│ logging ns         │  │ monitoring ns   │  │ tracing ns               │
│ Promtail ──> Loki  │  │ Prometheus      │  │ Tempo (OTLP :4318)       │
└────────────────────┘  │ Grafana         │  └──────────────────────────┘
                        │ Alertmanager    │
                        └────────┬────────┘
                                 │ queries Loki + Prometheus + Tempo
                                 v
                              Grafana UI
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
| **common** | Shared errors, middlewares, logger, metrics, events, NATS trace propagation | — | — | — |

Supporting infra:

| Component | Purpose |
|-----------|---------|
| **nats** | NATS Streaming server (event bus) |
| **\*-mongo** | Dedicated MongoDB per service |
| **expiration-redis** | Redis for Bull delay queues |
| **ingress** | Path-based routing to services |
| **Helm chart** | `infra/helm/ticketing` (used by Skaffold) |
| **Prometheus stack** | `monitoring` namespace |
| **Loki + Promtail** | `logging` namespace |
| **Tempo** | `tracing` namespace (OTLP receiver) |

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
| `Ticket` (local replica) | `title`, `price`, `version` + `isReserved()` |
| `Order` | `userId`, `status`, `expiresAt`, `ticket` (ref), `version` |

### Payments

| Model | Fields |
|-------|--------|
| `Order` (local replica) | `userId`, `price`, `status`, `version` |
| `Payment` | `orderId`, `stripeId` |

## Auth Model

- JWT stored in a cookie session (`cookie-session`, unsigned).
- `currentUser` / `requireAuth` from `@kumar-chaitanya/common-ticketing-service`.
- Shared `JWT_KEY` Kubernetes secret across services.

## Observability (what we added)

### Shared common package (`@kumar-chaitanya/common-ticketing-service`)

Current published line: **1.0.7** (source in `common/`).

| Export | Purpose |
|--------|---------|
| `Logger` | Pino wrapper: JSON logs with `service` field |
| `requestLogger(logger)` | HTTP access log (skips `/metrics`) |
| `errorHandler(logger)` | Factory; logs CustomError as warn, others as error |
| `Metrics` | Singleton `prom-client` counter + histogram; `/metrics` + middleware |
| `Publisher` | Injects `_traceContext` into every NATS payload |
| `Listener` | Extracts `_traceContext` and runs `onMessage` in that context |

Each service wires:

```ts
export const logger = new Logger(process.env.OTEL_SERVICE_NAME || 'auth');

app.use(requestLogger(logger));
app.use(metrics.middleware);
// ... routes ...
app.use(errorHandler(logger));
```

`import './tracing'` is the **first line** of each service `index.ts` so auto-instrumentation patches Express, Mongoose, MongoDB, and Pino before those modules load.

Domain / NATS logs (examples):

- Startup: Mongo, NATS, listen (no `trace_id` — no request span exists)
- HTTP: `request completed`, `Order created`, `Payment created`
- Listeners: ticket reserved, order created, payment created, expiration scheduled
- Common `Listener` / `Publisher` log `Message received` / `Event published` with `service: "nats"`

Pino auto-instrumentation adds `trace_id`, `span_id`, and `trace_flags` when an active span exists.

### Metrics

- Endpoint: `GET /metrics` on port `3000`
- Core series: `http_requests_total`, `http_request_duration_seconds` (labels: `method`, `route`, `status_code`)
- Scraped by **ServiceMonitors** in `infra/monitoring/servicemonitors.yaml` (namespace `monitoring`, apps in `default`)
- Prometheus jobs appear as `auth-srv`, `tickets-srv`, `orders-srv`, `payments-srv`, `expiration-srv`

### Logging pipeline

| Piece | Namespace | Role |
|-------|-----------|------|
| App stdout (Pino JSON) | `default` | Structured logs |
| Promtail | `logging` | DaemonSet; ships pod logs to Loki |
| Loki | `logging` | Log store (SingleBinary + gateway) |
| Grafana | `monitoring` | UI for Prometheus + Loki + Tempo |

Values files:

- `infra/logging/loki-values.yaml`
- `infra/logging/promtail-values.yaml`
- `infra/monitoring/custom_kube_prometheus_stack.yaml` (includes Loki datasource)

### Tracing pipeline

| Piece | Namespace | Role |
|-------|-----------|------|
| `src/tracing.ts` (per service) | `default` | NodeSDK + OTLP HTTP exporter |
| Tempo | `tracing` | Trace store (SingleBinary, local backend) |
| Grafana | `monitoring` | Explore → Tempo |

Values / config:

- `infra/tracing/tempo-values.yaml`
- Helm `global.otelExporterOtlpEndpoint`: `http://tempo.tracing.svc.cluster.local:4318/v1/traces`
- Each app Deployment sets:
  - `OTEL_SERVICE_NAME` = `{{ .Values.<service>.image }}` (`auth`, `tickets`, …)
  - `OTEL_EXPORTER_OTLP_ENDPOINT` = that global URL

`tracing.ts` uses `resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME })`. FS auto-instrumentation is disabled to keep traces readable.

### NATS context propagation

NATS Streaming has no headers, so W3C `traceparent` is carried on the event body as `_traceContext`.

1. **Publisher** (`common`): `propagation.inject(context.active(), carrier)` then publishes `{ ...data, _traceContext }`. The NATS ack callback is wrapped in `context.with(activeContext)` so `"Event published"` keeps the same `trace_id`.
2. **Listener** (`common`): strips `_traceContext`, `propagation.extract(...)`, then runs the log + `onMessage` inside `context.with(extractedContext)`.

Immediate listeners (tickets reserve, payments store order, expiration *schedules* the job) stay on the **same trace** as `POST /api/orders`.

### Bull delayed jobs (span links, not parent-child)

A 15-minute delay must **not** be a child of the HTTP request — Tempo would show the order-creation trace as ~15 minutes.

- `order-created-listener` still stores `_traceContext` on the Bull job.
- `expiration-queue` starts a **new root span** (`process order expiration`) and **links** it to the original span.

Result:

- **Trace A** — `POST /api/orders` + immediate NATS work (~hundreds of ms)
- **Trace B** — Bull job + `expiration:complete` (few ms), with a link back to Trace A

Inspect delayed jobs in Redis:

```bash
kubectl exec -it deploy/expiration-redis-depl -- redis-cli
KEYS bull:order:expiration:*
ZRANGE bull:order:expiration:delayed 0 -1 WITHSCORES
HGETALL bull:order:expiration:1
```

### `app` vs `service` (important)

| Field | Source | Example |
|-------|--------|---------|
| **`app`** | Kubernetes pod label (`app: orders`) → Loki stream label | `{app="orders"}` |
| **`service`** | Pino `base.service` (from `OTEL_SERVICE_NAME`, or `"nats"` in base classes) | `"service":"orders"` or `"service":"nats"` |

NATS base-class logs run **inside** the orders/tickets/… pod, so Loki shows `app=orders` with `service=nats`.

Filter examples:

```logql
{app="orders"} | json | service="orders"
{app="orders"} | json | service="nats"
{app=~"auth|tickets|orders|payments|expiration"} | json | trace_id="14e47ddb5defc03bb191eeb0449d95e2"
```

### Publishing common

```powershell
cd common
npm run build
# version already set in package.json when bumping
npm publish --access public
# then in each service:
npm install @kumar-chaitanya/common-ticketing-service@^1.0.7
```

Do **not** run `npm version` again if you already bumped `package.json` manually.

## Deploy & local workflows

### Helm vs Skaffold (concept)

| Approach | Image tags | When to use |
|----------|------------|-------------|
| **Skaffold `dev`** | Builds + pushes unique tags (e.g. git SHA), injects into Helm | Day-to-day local coding |
| **Helm alone** | Chart uses `chaitanyadocker1/<image>` → effectively **`:latest`** | Manual deploy after `docker push` |
| **Manual Docker** | You build/push; may need `kubectl rollout restart` if tag unchanged | Learning / prod-like practice |

`skaffold.yaml`: `push: true`, Helm release `ticketing` from `infra/helm/ticketing`.

**Rule:** don’t mix “manual docker push” with `skaffold dev` for the same change — Skaffold owns images while it runs.

### Helm upgrade vs rollout restart

- `helm upgrade` rolls pods only if the **Deployment pod template** changes (new image tag, env, etc.).
- Pushing new bits to the **same** tag (`:latest`) often needs `kubectl rollout restart deployment/<name>` because the manifest did not change.

### Install / upgrade observability

```powershell
# Logging stack
kubectl create namespace logging
helm upgrade --install loki grafana/loki -n logging -f infra/logging/loki-values.yaml
helm upgrade --install promtail grafana/promtail -n logging -f infra/logging/promtail-values.yaml

# Tracing stack
kubectl create namespace tracing
helm upgrade --install tempo grafana/tempo -n tracing -f infra/tracing/tempo-values.yaml

# Grafana Loki datasource (monitoring stack)
helm upgrade monitoring prometheus-community/kube-prometheus-stack `
  -n monitoring -f infra/monitoring/custom_kube_prometheus_stack.yaml --reuse-values

# App ServiceMonitors (if not already applied)
kubectl apply -f infra/monitoring/servicemonitors.yaml
```

Add a Tempo datasource in Grafana if it is not already there:

- Type: Tempo
- URL: `http://tempo.tracing.svc.cluster.local:3200`

## Grafana dashboards (revision)

Access Grafana:

```powershell
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Login: `admin` / `prom-operator` (from values).

### Suggested “Ticketing overview” panels

| Panel | Viz | Query |
|-------|-----|--------|
| Request rate | Time series | `sum(rate(http_requests_total[1m])) by (job)` |
| Avg latency | Time series | `sum(rate(http_request_duration_seconds_sum[1m])) by (job) / sum(rate(http_request_duration_seconds_count[1m])) by (job)` |
| Services up | Stat (Instant) | `up{job=~".*-srv"}` |
| Error counts (window) | Time series or Instant Stat | `sum(increase(http_requests_total{status_code=~"4..\|5.."}[15m])) by (job, status_code)` |
| Error rate (live) | Time series | `sum(rate(http_requests_total{status_code=~"4..\|5.."}[1m])) by (job)` |
| Exact error counters | Stat (Instant) | `sum by (job, status_code) (http_requests_total{status_code=~"4..\|5.."})` |
| App logs | Logs | `{app=~"auth\|tickets\|orders\|payments\|expiration"}` |
| Warn/error logs | Logs | `{app=~"auth\|tickets\|orders\|payments\|expiration"} \| json \| level >= 40` |
| Logs for one trace | Logs | `{app=~"auth\|tickets\|orders\|payments\|expiration"} \| json \| trace_id="<id>"` |

### Traces (Grafana Explore → Tempo)

1. Create an order (or any HTTP request).
2. Explore → Tempo → Search by service name (`orders`, `tickets`, …) or paste `trace_id` from a Loki log.
3. Order creation should show one connected trace: orders HTTP → NATS `order:created` → tickets / payments / expiration (schedule only).
4. After the delay, a **separate** expiration trace appears, linked to the original (not a 15-minute child span).

### Prometheus gotchas (worth memorizing)

1. **`rate` / `increase` need scrapes that see the counter move.** A short burst before the first scrape can show absolute counts but `increase(...) ≈ 0`.
2. **`increase()` returns floats** (e.g. `34.8`) due to extrapolation — normal.
3. **Stat + Range query** often shows **0**; use **Instant** for Stat, or keep **Time series** for `rate`/`increase`.
4. Absolute `http_requests_total{status_code=...}` = counts **since pod start** (resets on restart).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Services | Node.js, TypeScript, Express |
| Frontend | Next.js (Pages Router), Stripe checkout |
| Data | MongoDB (Mongoose), Redis (Bull) |
| Events | NATS Streaming |
| Shared | `@kumar-chaitanya/common-ticketing-service` (npm) |
| Metrics | `prom-client`, Prometheus Operator ServiceMonitors |
| Logs | Pino → Promtail → Loki (`trace_id` via Pino auto-instrumentation) |
| Traces | OpenTelemetry NodeSDK → Tempo (OTLP HTTP) |
| UI | Grafana (Prometheus + Loki + Tempo) |
| Deploy | Docker, Kubernetes, Helm, Skaffold |
| Ingress | NGINX Ingress Controller |

## Project Structure

```text
ticketing/
├── auth/ tickets/ orders/ payments/ expiration/ client/
├── common/                 # Shared npm library (Logger, Metrics, events, NATS trace context)
├── infra/
│   ├── helm/ticketing/     # App Helm chart (Skaffold deploys this)
│   ├── k8s/                # Older raw manifests (reference)
│   ├── monitoring/         # Prometheus values + ServiceMonitors
│   ├── logging/            # Loki + Promtail values
│   └── tracing/            # Tempo values
├── nats-test/              # Local NATS experiments
├── skaffold.yaml
└── readme.MD
```

Per-service observability pattern:

```text
src/tracing.ts         # NodeSDK first; OTEL_SERVICE_NAME + OTLP endpoint
src/logger.ts          # new Logger(process.env.OTEL_SERVICE_NAME || '<service>')
src/app.ts             # requestLogger + errorHandler(logger) + Metrics
src/index.ts           # import './tracing' first, then startup logs
src/nats-wrapper.ts    # Connected to NATS
src/events/listeners/  # domain success logs (inherit extracted NATS context)
```

## Getting Started

### Prerequisites

- Docker Desktop with Kubernetes enabled
- [Skaffold](https://skaffold.dev/) + Helm
- NGINX Ingress Controller
- Hosts entry: `127.0.0.1 ticketing.dev`

### Secrets

```bash
kubectl create secret generic jwt-secret --from-literal=JWT_KEY=your_jwt_key
kubectl create secret generic stripe-secret --from-literal=STRIPE_KEY=sk_test_your_stripe_secret_key
```

### Run apps locally

```bash
skaffold dev
```

Open: `https://ticketing.dev`

Skaffold builds/pushes images, deploys the Helm chart, and file-syncs `src/**/*.ts` for fast reloads when possible. Dependency changes (`package.json`) trigger a full rebuild.

### Docker images

| Image | Service |
|-------|---------|
| `chaitanyadocker1/auth` | Auth |
| `chaitanyadocker1/tickets` | Tickets |
| `chaitanyadocker1/orders` | Orders |
| `chaitanyadocker1/payments` | Payments |
| `chaitanyadocker1/expiration` | Expiration |
| `chaitanyadocker1/ticketing-client` | Client |

## Testing

```bash
cd auth      && npm test
cd tickets   && npm test
cd orders    && npm test
cd payments  && npm test
```

## Useful Commands

```bash
# Apps
kubectl get pods
kubectl logs -f deploy/orders-depl
skaffold dev

# Manual image (without Skaffold)
docker build -t chaitanyadocker1/auth ./auth
docker push chaitanyadocker1/auth
helm upgrade --install ticketing ./infra/helm/ticketing
kubectl rollout restart deployment/auth-depl

# Observability
kubectl get pods -n monitoring
kubectl get pods -n logging
kubectl get pods -n tracing
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
helm list -A
```

## Concept cheat-sheet (interview revision)

| Concept | In this project |
|---------|-----------------|
| **Database per service** | Separate Mongo per auth/tickets/orders/payments |
| **Event-driven** | NATS subjects; no cross-DB joins |
| **Optimistic concurrency** | `version` + `mongoose-update-if-current` |
| **CQRS-ish replicas** | Orders keeps a ticket copy; payments keeps an order copy |
| **Idempotent consumers** | Durable subscriptions + version checks |
| **API gateway** | NGINX Ingress path routing |
| **Shared kernel** | `common` npm package |
| **Metrics** | RED-ish: rate, errors, duration via Prometheus |
| **Logs** | Structured JSON for aggregation (Loki) |
| **Distributed tracing** | OpenTelemetry + Tempo; W3C context on NATS `_traceContext` |
| **Span vs link** | Parent-child for immediate work; span **links** for delayed Bull jobs |
| **Correlation** | Same `trace_id` on Pino logs and Tempo spans |
| **GitOps/CI mental model** | Local = Skaffold; real prod = CI builds immutable tags, CD deploys |

### Suggested next steps (not done yet)

- Grafana Tempo ↔ Loki links (trace → logs and log → trace)
- Alerting rules (Prometheus / Alertmanager)
- Kubernetes readiness / liveness probes
- Persist Mongo with PVCs
- Export Grafana dashboard JSON into the repo

## Notes

- Databases are **not shared**; read models update via events.
- `expiration` has no Ingress route; NATS + Redis/Bull only (plus `/metrics`).
- Mongo pods are ephemeral unless you add PVCs.
- Stripe publishable key lives in the client; secret key is a K8s secret.
- Helm chart app images omit an explicit tag → `:latest` unless Skaffold injects a digest/tag.
- Tempo uses the deprecated `grafana/tempo` SingleBinary chart — fine for local/learning; production would use `tempo-distributed`.
