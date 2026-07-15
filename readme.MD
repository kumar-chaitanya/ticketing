# Ticketing

A microservices-based ticketing platform where sellers can list tickets for events and buyers can browse and purchase them.

## Overview

This application is built as a collection of independent services, each responsible for a specific domain. Users sign up and authenticate through the auth service, then interact with other services to create listings, search for tickets, and complete purchases.

**Sellers** can create and manage ticket listings for concerts, sports games, theater shows, and other events.

**Buyers** can search available tickets, view listing details, and purchase tickets from sellers.

## Architecture

The system is designed around small, focused services that communicate over HTTP. Kubernetes is used to run and orchestrate the services locally and in deployment environments.

| Service   | Responsibility                          | Status        |
|-----------|-----------------------------------------|---------------|
| `auth`    | User registration, sign-in, and sessions | In progress   |
| `tickets` | Create and manage ticket listings        | Planned       |
| `orders`  | Handle ticket purchases and orders       | Planned       |

Traffic is routed through an NGINX ingress controller. The auth service is currently exposed at `/api/users`.

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express
- **Infrastructure:** Docker, Kubernetes, Skaffold
- **Ingress:** NGINX Ingress Controller

## Project Structure

```
ticketing/
├── auth/           # Authentication service
├── infra/k8s/      # Kubernetes manifests
└── skaffold.yaml   # Local development configuration
```

## Getting Started

### Prerequisites

- Docker Desktop with Kubernetes enabled
- Skaffold
- NGINX Ingress Controller installed in your cluster

### Run locally

From the project root:

```bash
skaffold dev
```

The auth service listens on port 3000 inside the cluster. With the ingress configured, requests to `ticketing.dev/api/users` are routed to the auth service.

Add `ticketing.dev` to your hosts file pointing to your cluster's ingress IP if needed.
