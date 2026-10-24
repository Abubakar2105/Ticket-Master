# TicketMaster — Scalable Ticket-Booking Backend

A movie ticket-booking backend inspired by platforms like BookMyShow, built with **Node.js, Express, PostgreSQL, Prisma, and Redis Cluster**. The project combines temporary seat holds, transactional outbox events, Redis Streams, cached read models, connection pooling, and Kubernetes autoscaling.

---

## Table of Contents

- [Features](#features)
- [Application Modules](#application-modules)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [CQRS and Transactional Outbox](#cqrs-and-transactional-outbox)
- [Redis Streams and Background Processing](#redis-streams-and-background-processing)
- [Concurrency and Seat Locking](#concurrency-and-seat-locking)
- [Caching Layer](#caching-layer)
- [Authentication and Rate Limiting](#authentication-and-rate-limiting)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Docker Compose](#docker-compose)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Scaling](#scaling)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- User registration, login, and profile retrieval.
- JWT authentication with user and administrator access checks.
- Movie creation and browsing.
- Show creation with end times calculated from movie duration.
- Seat availability checks for a specific show.
- Two-minute checkout holds, capped at the show's start time.
- Reservation cancellation and expiration handling during booking and payment operations.
- Simulated payment initiation and verification.
- Booking confirmation and stored payment-confirmation notifications.
- Redis distributed locks and a PostgreSQL partial unique index for active reservations.
- Transactional outbox events for application writes.
- Redis Streams publishing, consumer groups, acknowledgments, and pending-message retries.
- Separate command and query databases with projection-driven read models.
- Redis cache-aside reads with projection-side invalidation.
- PgBouncer transaction pooling for both databases.
- Kubernetes API and worker deployments, health probes, HPA, and Nginx Ingress.
- Prometheus HTTP and Node.js process metrics.
- Automated controller, projection, and mocked HTTP regression tests.

## Application Modules

The application runs as an **Express API** and a **background worker**. API handlers are organized into command and query controller folders.

| Module | Responsibility |
| --- | --- |
| Users | Registration, authentication, profiles, administrator-only user listing |
| Movies | Movie metadata creation and cached movie browsing |
| Shows | Show creation, movie-duration scheduling, and cached show listings |
| Reservations | Availability checks, seat holds, cancellation, and user bookings |
| Payments | Simulated payment records, verification, and reservation confirmation |
| Notifications | Stored payment-confirmation messages and user notification retrieval |
| Events and projections | Outbox publishing, Redis Streams consumption, read-model updates, and cache invalidation |

## Technology Stack

| Category | Technology | Role |
| --- | --- | --- |
| Runtime | Node.js 22 | API and worker processes; container image uses `node:22-alpine` |
| HTTP framework | Express 5 | REST routing and middleware |
| Database | PostgreSQL 16.2 | Independent command and query databases |
| ORM | Prisma 7 | Separate generated clients and transaction APIs |
| PostgreSQL adapter | `@prisma/adapter-pg` and `pg` | Database connections and client pools |
| Connection pooler | PgBouncer | Transaction pooling in front of both databases |
| Redis client | ioredis | Redis Cluster connections and commands |
| Cache and locks | Redis 7 | Cached reads and distributed seat locks |
| Event transport | Redis Streams | Outbox-event delivery to projection consumers |
| Authentication | JSON Web Tokens and bcryptjs | Signed tokens and password hashing |
| Rate limiting | express-rate-limit | Per-process request counters |
| Metrics | prom-client and Prometheus | Request counters, duration histograms, and process metrics |
| Visualization | Grafana | Metrics exploration through the Compose service |
| Containers | Docker and Docker Compose | Local API, worker, database, Redis, and monitoring services |
| Orchestration | Kubernetes HPA and Nginx Ingress | API replica scaling and HTTP traffic routing |
| Testing | Node.js test runner | Isolated regression tests |
| Load testing | Autocannon | HTTP throughput and latency measurements |

---

## Architecture

### Application and Data Architecture

```text
                                  Clients
                                     |
                                     v
                    +--------------------------------+
                    |  Nginx Ingress / Load Balancer |
                    +----------------+---------------+
                                     |
                                     v
                    +--------------------------------+
                    | Kubernetes ticket-api Service  |
                    |    Port 80 --> API port 3000   |
                    +----------------+---------------+
                                     |
              +----------------------+----------------------+
              |                      |                      |
              v                      v                      v
   +---------------------+ +---------------------+ +---------------------+
   |    Express API 1    | |    Express API 2    | |    Express API N    |
   | Auth + rate limits  | | Auth + rate limits  | | Auth + rate limits  |
   | Commands + queries  | | Commands + queries  | | Commands + queries  |
   +----------+----------+ +----------+----------+ +----------+----------+
              |                      |                      |
              +----------------------+----------------------+
                                     |
                     +---------------+---------------+
                     |                               |
                     v                               v
          +---------------------+         +---------------------+
          | Command controllers |         |  Query controllers  |
          | Register / create   |         | Movies / shows       |
          | Reserve / cancel    |         | Profiles / bookings  |
          | Initiate / verify   |         | Notifications        |
          +----------+----------+         +----------+----------+
                     |                               |
                     |                     +---------+---------+
                     |                     |                   |
                     v                     v                   v
          +---------------------+   +-------------+   +-----------------+
          |    PgBouncer CMD    |   | Redis cache |   | PgBouncer QUERY |
          +----------+----------+   +-------------+   +--------+--------+
                     |                                        |
                     v                                        v
          +---------------------+                  +---------------------+
          | Command PostgreSQL  |                  |  Query PostgreSQL   |
          | Domain tables       |                  |  Projection tables  |
          | + outbox_events     |                  |  *_views            |
          +----------+----------+                  +----------^----------+
                     |                                        |
                     v                                        |
          +---------------------+     +------------------+     |
          |   Outbox publisher  |---->|   Redis Streams  |     |
          +---------------------+     |  events-stream   |     |
                                      +--------+---------+     |
                                               |               |
                                               v               |
                                      +------------------+     |
                                      |   Projection     |-----+
                                      |    consumer      |
                                      +--------+---------+
                                               |
                                               v
                                      Cache invalidation
```

Each Express instance runs both command and query handlers and connects to the same PostgreSQL/PgBouncer and Redis infrastructure. Kubernetes HPA scales the API Deployment from 3 to 20 replicas; the Service routes incoming Nginx traffic to ready API pods.

The command database stores authoritative application state. The query database stores projection tables maintained by the worker. They are separate PostgreSQL services connected through application events.

Authentication, payment decisions, and seat availability checks read the command database directly. Browsing, profile, booking-list, and notification queries use the query database and Redis caching.

### Controller Separation

```text
src/controllers/
|
+-- command/
|   +-- user.controller.js          Registration and login
|   +-- movie.controller.js         Movie creation
|   +-- shows.controller.js         Show creation
|   +-- reservation.controller.js   Reserve and cancel
|   +-- payment.controller.js       Initiate and verify payment
|
+-- query/
    +-- user.controller.js          User listing and profiles
    +-- movie.controller.js         Movie listing
    +-- show.controller.js          Show listing
    +-- reservation.controller.js   Availability and user bookings
    +-- notification.controller.js  User notifications
```

Command/query separation is implemented in controllers and database clients. HTTP routes retain resource paths such as `/movies`, `/shows`, `/seats`, and `/payments`.

---

## CQRS and Transactional Outbox

> **Command Query Responsibility Segregation:** application writes and read-model queries use separate controllers and database clients.

### Write-to-Read Flow

```text
    Command request
          |
          v
 +--------------------------------------------------+
 |        One command-database transaction           |
 |                                                  |
 |  1. Create or update the domain record            |
 |  2. Insert a JSON event into outbox_events         |
 |  3. Commit both changes together                  |
 +------------------------+-------------------------+
                          |
                          v
                +-------------------+
                |  PENDING outbox   |
                |      events       |
                +---------+---------+
                          |
                          | Outbox polling
                          v
                +-------------------+
                |   Redis XADD      |
                |   events-stream   |
                +---------+---------+
                          |
                          | Mark outbox event PUBLISHED
                          | Consume with XREADGROUP
                          v
                +-------------------+
                | Projection handler|
                | Upsert read model |
                +---------+---------+
                          |
                          | Commit projection
                          v
                +-------------------+
                | Invalidate cache  |
                | Acknowledge XACK  |
                +---------+---------+
                          |
                          v
                Query request reads
                updated views/cache
```

### Outbox Record

The command schema defines `OutboxEvent`, mapped to `outbox_events`:

| Field | Purpose |
| --- | --- |
| `id` | UUID event identifier |
| `eventType` | Event name, mapped to `event_type` |
| `aggregateId` | Domain-record identifier, mapped to `aggregate_id` |
| `payload` | JSON representation of the application record |
| `status` | `PENDING` or `PUBLISHED` |
| `createdAt` | Event creation timestamp |
| `publishedAt` | Publication timestamp |

The shared `append` helper serializes dates and decimal values before inserting the outbox row. User events contain public profile fields rather than password hashes.

### Application Events

| Event | Projection behavior |
| --- | --- |
| `user-created` | Upserts the public user view and invalidates user caches |
| `movie-created` | Upserts the movie view and invalidates the movie list |
| `show-created` | Builds the show view with movie metadata and invalidates the show list |
| `reservation-created` | Projects current reservation and associated payment state |
| `reservation-updated` | Projects cancellation, expiration, or confirmation changes |
| `reservation-canceled` | Registered handler for cancellation events already in the event stream |
| `payment-created` | Projects the associated reservation and payment |
| `payment-updated` | Projects payment status and associated booking state |
| `notification-created` | Upserts the notification view and invalidates the user's notification cache |

Reservation and payment projections read the current command record under a query-database transaction-level advisory lock. The handler updates booking and payment views together, then invalidates the booking cache after committing.

---

## Redis Streams and Background Processing

The worker entry point, [src/worker.js](src/worker.js), starts the outbox publisher and event consumer together.

```text
                     npm run worker
                           |
              +------------+------------+
              |                         |
              v                         v
    +-------------------+     +------------------------+
    | Outbox publisher  |     | Projection consumer    |
    | Poll PostgreSQL   |     | Group: event-consumers |
    | Publish with XADD |     | Unique consumer name   |
    +---------+---------+     +------------+-----------+
              |                            ^
              v                            |
    +-------------------------------------------------+
    |            Redis Stream: events-stream          |
    | eventId | eventType | aggregateId | payload      |
    +-------------------------------------------------+
                                           |
                              +------------+------------+
                              |                         |
                              v                         v
                         XREADGROUP                XAUTOCLAIM
                         New events                Pending retry
                              |                         |
                              +------------+------------+
                                           |
                                           v
                                  Projection + cache
                                      invalidation
                                           |
                                           v
                                          XACK
```

| Setting | Value in source |
| --- | --- |
| Outbox batch size | 10 events |
| Outbox polling interval | 5 seconds |
| Stream name | `events-stream` |
| Consumer group | `event-consumers` |
| Consumer batch size | 10 messages |
| Blocking read time | 5 seconds |
| Pending-message claim threshold | 60 seconds of idle time |
| Consumer identity | Hostname, process ID, and UUID |

A message is acknowledged after its registered projection completes. Pending messages are reclaimed with `XAUTOCLAIM` and processed through the same handler path.

---

## Concurrency and Seat Locking

### Distributed Critical-Section Lock

Reservation, cancellation, and payment operations coordinate through the same show-and-seat Redis lock.

```text
       User A                    User B                    User C
     Show S / A1               Show S / A1               Show S / A2
         |                         |                         |
         v                         v                         v
 +----------------+       +----------------+       +----------------+
 | SET NX succeeds|       | SET NX fails   |       | SET NX succeeds|
 | Lock S:A1      |       | Same lock S:A1 |       | Lock S:A2      |
 +-------+--------+       +-------+--------+       +-------+--------+
         |                       |                        |
         v                       v                        v
 Command transaction        HTTP 409                Command transaction
 Domain state + outbox                              Domain state + outbox
         |                                                |
         v                                                v
 Token-checked Lua release                         Token-checked Lua release
```

The lock command is equivalent to:

```text
SET lock:seat:<showId>:<seatNumber> <unique-token> PX 15000 NX
```

- `NX` acquires the lock only when the key is absent.
- `PX 15000` sets a 15-second lock lease.
- A UUID identifies the lock owner.
- A Lua script deletes the key only when the stored token matches the owner.
- Booking and payment transactions use a 5-second maximum wait and a 5-second execution timeout.

### Database-Level Active-Seat Constraint

A command-database migration creates the following partial unique index:

```sql
CREATE UNIQUE INDEX "reservations_one_active_seat_per_show"
ON "reservations" ("show_id", "seat_number")
WHERE "status" IN ('HELD', 'CONFIRMED');
```

This enforces one active reservation per show and seat while retaining cancelled and expired reservation history.

### Reservation Lifecycle

```text
                          Reserve seat
                               |
                               v
                         +-----------+
                         |   HELD    |
                         | Up to 2m  |
                         +-----+-----+
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
       Owner cancels     Hold expires      Payment succeeds
              |                |                |
              v                v                v
       +-------------+  +-------------+  +-------------+
       |  CANCELLED  |  |   EXPIRED   |  |  CONFIRMED  |
       +-------------+  +-------------+  +-------------+
              |                |
              +--------+-------+
                       |
                       v
                Seat can be held again
```

The checkout hold is stored in PostgreSQL as `expiresAt`; it is separate from the short Redis coordination lock. Expired holds are updated during rebooking, cancellation, and payment operations. Availability checks treat an expired hold as inactive.

Successful simulated payment verification updates the payment and reservation, creates a confirmation notification, and appends their events in the same transaction.

---

## Caching Layer

Read handlers use the cache-aside pattern:

```text
                          Query request
                                |
                                v
                         +--------------+
                         | Redis GET key|
                         +------+-------+
                                |
                    +-----------+-----------+
                    |                       |
                  HIT                     MISS
                    |                       |
                    v                       v
             Return cached JSON       Query PostgreSQL
                                            |
                                            v
                                      Redis SETEX key
                                            |
                                            v
                                       Return JSON

    Command event --> Projection commit --> DEL affected cache key
```

### Cache Keys and TTLs

| Key | Data | TTL |
| --- | --- | --- |
| `movies:all` | Movie list | 60 seconds |
| `shows:all` | Show list | 30 seconds |
| `users:all` | Public user list | 60 seconds |
| `user:<id>` | Public user profile | 60 seconds |
| `reservations:user:<id>` | User reservation views with payment records | 30 seconds |
| `notifications:user:<id>` | User notifications | 60 seconds |

Cache hits and misses return the same response shape. Ownership and administrator checks run before private cached records are returned. Cache invalidation takes place after the corresponding read model has been updated.

### Redis Cluster Layout

[compose.yaml](compose.yaml) initializes six Redis nodes with one replica per primary shard.

```text
                         Shared Redis Cluster
                +-----------------------------------+
                | Cache keys                        |
                | Seat-lock keys                    |
                | Redis Stream: events-stream       |
                +-----------------------------------+
                           | Sharded keyspace
             +-------------+-------------+
             |             |             |
             v             v             v
       +-----------+ +-----------+ +-----------+
       | Primary A | | Primary B | | Primary C |
       +-----+-----+ +-----+-----+ +-----+-----+
             |             |             |
       Replication   Replication   Replication
             |             |             |
             v             v             v
       +-----------+ +-----------+ +-----------+
       | Replica A | | Replica B | | Replica C |
       +-----------+ +-----------+ +-----------+
```

All nodes enable Redis Cluster mode and append-only persistence. The ioredis client uses `REDIS_NODES` for discovery and optional `REDIS_NAT_MAP` entries to translate advertised node addresses.

---

## Authentication and Rate Limiting

### Authentication Flow

```text
     Email + password
            |
            v
   Command database user lookup
            |
            v
       bcrypt compare
            |
            v
       Signed JWT (1 day)
            |
            v
   Authorization: Bearer <token>
            |
            v
   Verify signature + user ID
            |
            v
   Load current command-database user
            |
            v
   Attach req.user --> Ownership / admin checks --> Controller
```

- Passwords are hashed with bcrypt using 12 rounds.
- Registration creates users with `is_admin: false`.
- Password input is bounded to bcrypt's 72-byte limit.
- Tokens contain the user ID and expire after one day.
- Authentication loads the current user's role from the command database.
- User listing and show creation require administrator access.
- Profile, booking-list, and notification reads permit the owner or a verified administrator.
- Reservation cancellation and payment mutations require ownership.

### Request Limits

The Express middleware uses per-process counters with a one-minute window.

| Mounted resource | Limit per IP per minute |
| --- | --- |
| `/users` | 10 |
| `/movies`, `/shows`, `/notification` | 120 |
| `/seats` | 20 |
| `/payments` | 10 |

---

## Database Schema

### Command Database

The command schema is defined in [prisma/command/schema.prisma](prisma/command/schema.prisma).

```text
 User ---------------------> Reservation <--------------------- Show
   |                              |                              |
   |                              | One payment per reservation |
   |                              v                              v
   +--------------------------> Payment                        Movie
   |
   +--------------------------> Notification

 Domain transaction ---------> OutboxEvent
```

| Prisma model | PostgreSQL table | Main fields |
| --- | --- | --- |
| `User` | `users` | Username, email, password hash, administrator flag |
| `Movie` | `movies` | Name, genre, duration |
| `Show` | `shows` | Movie ID, theater, start and end time |
| `Reservation` | `reservations` | User ID, show ID, seat number, status, expiration |
| `Payment` | `payments` | Reservation ID, user ID, decimal amount, status, provider |
| `Notification` | `notifications` | User ID, type, message, status |
| `OutboxEvent` | `outbox_events` | Event type, aggregate ID, JSON payload, publication state |

Users, movies, shows, reservations, payments, and notifications use CUID identifiers. Outbox events use UUID identifiers. Seat numbers are string labels, such as `A1`, stored with a maximum length of 10 characters.

**Reservation statuses:** `HELD`, `CONFIRMED`, `CANCELLED`, `EXPIRED`.

**Payment statuses defined in the schema:** `PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`.

The command schema includes unique username/email fields, a unique payment reservation ID, a unique optional transaction ID, and indexes supporting user/status and show/seat reservation lookups.

### Query Database

The read models are defined in [prisma/query/schema.prisma](prisma/query/schema.prisma).

| Read model | PostgreSQL table | Read data |
| --- | --- | --- |
| `User` | `user_views` | Public profile fields |
| `Movie` | `movie_views` | Movie browsing metadata |
| `Show` | `show_views` | Movie name, genre, theater, and show times |
| `Reservation` | `reservation_views` | User booking state with show/movie metadata |
| `Payment` | `payment_views` | Associated payment records |
| `Notification` | `notification_views` | User notification messages |

Show and reservation views contain denormalized movie/show fields. Reservation-list queries combine reservation views with associated payment views before caching the response.

### Connection Pooling

```text
        API / Worker Prisma clients
                    |
          +---------+---------+
          |                   |
          v                   v
    PgBouncer CMD       PgBouncer QUERY
    Transaction pool    Transaction pool
          |                   |
          v                   v
    Command PostgreSQL  Query PostgreSQL
```

Both Prisma adapters configure a client pool with `max: 100` and `min: 20`. Each PgBouncer configuration uses transaction pooling, `max_client_conn = 1000`, `default_pool_size = 100`, `min_pool_size = 20`, and SCRAM-SHA-256 authentication.

---

## Getting Started

### Prerequisites

- Node.js 22.18 or newer within the Node.js 22 line, or a newer runtime supporting the generated TypeScript Prisma clients.
- npm.
- PostgreSQL and a Redis Cluster, available locally or through Docker Compose.
- Docker and Docker Compose for the container setup.
- kubectl and a Kubernetes cluster for the Kubernetes deployment.

### Install Dependencies

Run from the repository root:

```bash
npm ci
```

### Environment Variables

Create a root `.env` using values appropriate for your environment:

```dotenv
PORT=3000
NODE_ENV=development
JWT_SECRET=<your-jwt-signing-secret>
DB_PASSWORD=<your-local-database-password>

COMMAND_DATABASE_URL=postgresql://user:<url-encoded-password>@localhost:6432/ticket-master
QUERY_DATABASE_URL=postgresql://user:<url-encoded-password>@localhost:6433/ticket-query
COMMAND_DIRECT_URL=postgresql://user:<url-encoded-password>@localhost:5432/ticket-master
QUERY_DIRECT_URL=postgresql://user:<url-encoded-password>@localhost:5433/ticket-query

REDIS_NODES=localhost:7001,localhost:7002,localhost:7003,localhost:7004,localhost:7005,localhost:7006
REDIS_NAT_MAP={"172.28.0.11:6379":{"host":"localhost","port":7001},"172.28.0.12:6379":{"host":"localhost","port":7002},"172.28.0.13:6379":{"host":"localhost","port":7003},"172.28.0.14:6379":{"host":"localhost","port":7004},"172.28.0.15:6379":{"host":"localhost","port":7005},"172.28.0.16:6379":{"host":"localhost","port":7006}}
```

| Variable | Used by |
| --- | --- |
| `PORT` | API listener; defaults to 3000 |
| `JWT_SECRET` | JWT signing and verification |
| `DB_PASSWORD` | Compose PostgreSQL services and application database URLs |
| `COMMAND_DATABASE_URL` | Command Prisma client |
| `QUERY_DATABASE_URL` | Query Prisma client |
| `COMMAND_DIRECT_URL` | Command Prisma migration configuration |
| `QUERY_DIRECT_URL` | Query Prisma migration configuration |
| `REDIS_NODES` | Comma-separated Redis Cluster startup nodes |
| `REDIS_NAT_MAP` | Optional JSON address mapping for host/container networking |

Compose supplies container-network database and Redis addresses to the API and worker. The localhost example above is for running Node.js on the host against Compose infrastructure.

### Prepare Both Databases and Clients

Each database has its own schema, configuration, migrations, and generated client. Run these preparation commands when setting up the database environment:

```bash
npx prisma migrate deploy --config prisma/command/prisma7.config.ts
npx prisma migrate deploy --config prisma/query/prisma7.config.ts

npx prisma generate --config prisma/command/prisma7.config.ts
npx prisma generate --config prisma/query/prisma7.config.ts
```

Migration URLs point directly at PostgreSQL. Runtime URLs point at the respective PgBouncer service.

### Run the API and Worker

```bash
# API with automatic reload
npm run dev

# API without automatic reload
npm start

# Background worker in a separate terminal
npm run worker
```

The default API address is `http://localhost:3000`.

---

## Docker Compose

### Services Overview

| Compose service | Image / runtime | Host port | Responsibility |
| --- | --- | --- | --- |
| `postgres` | `postgres:16.2` | 5432 | Command database, `ticket-master` |
| `postgres_query` | `postgres:16.2` | 5433 | Query database, `ticket-query` |
| `pgbouncer_cmd` | `edoburu/pgbouncer:v1.26.0-p0` | 6432 | Command connection pooler |
| `pgbouncer_query` | `edoburu/pgbouncer:v1.26.0-p0` | 6433 | Query connection pooler |
| `redis-node-1` through `redis-node-6` | `redis:7-alpine` | 7001–7006 | Redis Cluster nodes |
| `redis-cluster-init` | `redis:7-alpine` | — | One-shot cluster initialization |
| `api` | Project Dockerfile | 3000 | Express API |
| `worker` | Project Dockerfile | — | Outbox publisher and projection consumer |
| `prometheus` | `prom/prometheus` | 9090 | Metrics collection |
| `grafana` | `grafana/grafana` | 5003 | Metrics visualization |

The Dockerfile uses `node:22-alpine`, installs dependencies with `npm ci`, copies the project, and runs `server.js`. The worker uses the same build with `npm run worker` as its container command.

### Start Infrastructure

Configure `.env` and the mounted `pgbouncer/userlist.txt` authentication file first. Its SCRAM entry must match the PostgreSQL `user` account's password.

```bash
docker compose up -d postgres postgres_query pgbouncer_cmd pgbouncer_query redis-cluster-init
```

The initializer starts its six Redis dependencies, waits for node readiness, and creates the cluster with `--cluster-replicas 1`.

After preparing both databases and generated clients:

```bash
docker compose up -d --build api worker prometheus grafana
docker compose ps
```

### Logs and Database Access

```bash
docker compose logs -f api worker

docker compose exec postgres psql -U user -d ticket-master
docker compose exec postgres_query psql -U user -d ticket-query
```

### Published Addresses

| Component | Address |
| --- | --- |
| API | `http://localhost:3000` |
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:5003` |

PostgreSQL, Prometheus, and Grafana use named volumes in Compose. Redis nodes enable AOF in their container data directories. Application infrastructure uses the `ticket-booking-network` bridge with subnet `172.28.0.0/16`.

---

## API Endpoints

### Base URL

```text
http://localhost:3000
```

Authenticated requests use:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Command and Authentication Endpoints

| Method | Endpoint | Access | Request body |
| --- | --- | --- | --- |
| POST | `/users/register` | Public | `{"username":"alex","email":"alex@example.com","password":"your-password"}` |
| POST | `/users/login` | Public | `{"email":"alex@example.com","password":"your-password"}` |
| POST | `/movies` | Authenticated | `{"name":"Inception","genre":"Sci-Fi","duration":148}` |
| POST | `/shows` | Administrator | `{"movie_id":"<movie-id>","theater":"Theater A","start_time":"<future-ISO-timestamp>"}` |
| POST | `/seats/reserve` | Authenticated | `{"show_id":"<show-id>","seat_id":"A1"}` |
| POST | `/seats/reservation/cancel` | Reservation owner | `{"reservation_id":"<reservation-id>"}` |
| POST | `/payments/initiate` | Reservation owner | `{"reservation_id":"<reservation-id>","amount":"500.00"}` |
| POST | `/payments/verify` | Payment owner | `{"payment_id":"<payment-id>","payment_result":"SUCCESS"}` |

Movie duration is a positive integer in minutes. Show times must be in the future. Payment amounts are positive numbers or decimal strings with up to two fractional digits. The simulated payment provider is `SIMULATED`, and verification accepts `SUCCESS` or `FAILED`.

### Query Endpoints

| Method | Endpoint | Access | Result |
| --- | --- | --- | --- |
| GET | `/movies` | Public | Cached movie list |
| GET | `/shows` | Public | Cached show list |
| GET | `/users` | Administrator | Cached public user fields |
| GET | `/users/:id` | Owner or administrator | Cached public profile |
| GET | `/seats/:seat_id?show_id=<show-id>` | Public | Authoritative seat availability |
| GET | `/seats/reservation/:user_id` | Owner or administrator | Cached booking views with payment records |
| GET | `/notification/:user_id` | Owner or administrator | Cached user notifications |

### System Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/ping` | Lightweight process response, `ok` |
| GET | `/health` | Command-database connectivity check with instance and timestamp |
| GET | `/metrics` | Prometheus text-format metrics |

### Booking Workflow

```text
 Register --> Login --> Browse movies and shows --> Check availability
                                                       |
                                                       v
                                                 Reserve seat
                                                       |
                                                       v
                                                Initiate payment
                                                       |
                                                       v
                                                Verify SUCCESS
                                                       |
                                                       v
                                     Reservation CONFIRMED + notification
                                                       |
                                                       v
                                Read bookings and notifications via projections
```

The authenticated user ID is taken from the token-backed request context. Booking and payment request bodies identify the show, seat, reservation, or payment being operated on.

---

## Testing

Run the automated suite without starting Docker:

```bash
npm test
```

The suite in [api.test.js](api.test.js) uses `node:test`, mocked Prisma/Redis dependencies, and real Express routes exercised over an ephemeral local HTTP server.

### Regression Coverage

| Area | Verified behavior |
| --- | --- |
| Cache reads | Matching hit/miss response shapes, including empty lists |
| Authorization | Ownership checked before private cache access; administrator reads |
| Users | Password hashing, public-field responses/events, byte limits, duplicate handling |
| Movies and shows | Input validation and duration-based show scheduling |
| Reservations | Saved-record outbox payloads, occupied seats, rebooking, cancellation, expiration |
| Payments | Amount validation, ownership, success/failure transitions, repeated verification |
| Transactions | Rollback on failed payment updates or failed outbox insertion |
| Projections | Snapshot upserts, booking/payment serialization, cache invalidation after commit |
| Event registration | Handlers for application event types |
| HTTP routing | Real app imports and mounted routes with mocked infrastructure |

Verified suite result: **39 tests passed, 0 failed**.

---

## Monitoring

### Metrics Flow

```text
   Express response
          |
          v
   prom-client registry
          |
          v
       /metrics <---------- Prometheus scrape every 15 seconds
                                      |
                                      v
                               Grafana exploration
```

The API exports:

- `http_requests_total` with `method`, `route`, and `status_code` labels.
- `http_request_duration_seconds` with histogram buckets from 10 milliseconds to 5 seconds.
- Default Node.js process metrics collected by prom-client.

HTTP timing uses `process.hrtime.bigint()`. The middleware records responses when they finish and uses route templates for labels. Prometheus configuration scrapes `host.docker.internal:3000/metrics` every 15 seconds.

### Example PromQL

Request throughput:

```promql
sum(rate(http_requests_total[5m]))
```

P95 request duration:

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

Server error percentage:

```promql
100 * sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/ clamp_min(sum(rate(http_requests_total[5m])), 1e-9)
```

### HTTP Load Testing

Autocannon is included as a development dependency. Run it against your local API:

```bash
npx autocannon -c 10 -d 30 http://localhost:3000/movies
npx autocannon -c 50 -d 30 http://localhost:3000/movies
```

Measure request rate, response latency, and errors alongside application, PostgreSQL, and Redis resource usage.

---

## Scaling

### Kubernetes and Load-Balancing Architecture

```text
                              HTTP clients
                                   |
                                   v
                   +--------------------------------+
                   |     Nginx Ingress Controller   |
                   |     Host: localhost            |
                   |     Path: /                    |
                   +---------------+----------------+
                                   |
                                   v
                   +--------------------------------+
                   |    ticket-api ClusterIP Service|
                   |    Port 80 --> container 3000  |
                   +---------------+----------------+
                                   |
                    +--------------+--------------+
                    |              |              |
                    v              v              v
              +-----------+  +-----------+  +-----------+
              | API Pod 1 |  | API Pod 2 |  | API Pod N |
              | Express   |  | Express   |  | Express   |
              +-----+-----+  +-----+-----+  +-----+-----+
                    |              |              |
                    +--------------+--------------+
                                   |
                    +--------------+--------------+
                    |              |              |
                    v              v              v
             +------------+ +------------+ +----------------+
             | PgBouncer  | | PgBouncer  | | Redis Cluster  |
             | Command    | | Query      | | Locks + cache  |
             +-----+------+ +-----+------+ | + events-stream|
                   |              |        +--------+-------+
                   v              v                 ^
             +------------+ +------------+          |
             | Command DB | | Query DB   |          |
             | + outbox   | | Read views |          |
             +-----+------+ +-----^------+          |
                   |              |                 |
                   +----------+   |   +-------------+
                              |   |   |
                              v   |   |
                         +--------+---+--------+
                         | ticket-worker Pod   |
                         | Outbox + projections|
                         +---------------------+

      metrics-server --> HPA --> ticket-api Deployment: 3 to 20 replicas
```

Kubernetes resources are defined under [k8s/](k8s/), in the `ticket-master` namespace. The API and worker use image `ticket-master-api:v4`. The deployment connects to shared PostgreSQL/PgBouncer and Redis infrastructure through its configured database URLs and Redis address mappings.

### API Deployment

| Setting | Configuration |
| --- | --- |
| Deployment | `ticket-api` |
| Initial replicas | 3 |
| Service | ClusterIP, port 80 to API port 3000 |
| CPU request / limit | 500m / 2 CPUs |
| Memory request / limit | 512Mi / 2Gi |
| Startup probe | `/ping` |
| Liveness probe | `/ping` |
| Readiness probe | `/health` |
| Termination grace period | 30 seconds |
| Pre-stop delay | 5 seconds |

### Horizontal Pod Autoscaler

```text
       API CPU / memory usage
                 |
                 v
           metrics-server
                 |
                 v
       +-----------------------+
       | HPA: ticket-api-hpa   |
       | CPU target: 70%       |
       | Memory target: 80%    |
       +-----------+-----------+
                   |
                   v
       +-----------------------+
       | ticket-api Deployment |
       | Min: 3 / Max: 20 pods |
       +-----------+-----------+
                   |
                   v
        Service distributes traffic
        across ready API replicas
```

The HPA targets resource utilization relative to pod requests. Scale-up permits the larger of a 100% increase or four additional pods per 15 seconds. Scale-down uses a 300-second stabilization window and a policy of at most 10% reduction per minute.

### Worker Deployment

The `ticket-worker` Deployment runs one replica containing both the outbox poller and Redis Streams consumer. It requests 100m CPU and 128Mi memory, with limits of one CPU and 512Mi memory.

### Nginx Ingress

[k8s/ingress.yaml](k8s/ingress.yaml) routes host `localhost`, path prefix `/`, to `ticket-api:80` using ingress class `nginx`. Its annotations configure a 50 MB proxy body-size setting, a 30-second connect timeout, and 300-second read/send timeouts.

### Deploy the Kubernetes Resources

Prepare an ingress-nginx controller, metrics-server, shared infrastructure reachable from the cluster, and the `ticket-master-api:v4` image in your cluster's image environment.

```bash
docker build -t ticket-master-api:v4 .
kubectl apply -f k8s/namespace.yaml
```

Create the following Secrets in namespace `ticket-master` using your environment's values:

| Secret | Required keys |
| --- | --- |
| `ticket-db-secret` | `command-url`, `query-url` |
| `ticket-app-secret` | `jwt-secret` |

Then apply the workload and routing manifests:

```bash
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/ingress.yaml

kubectl get pods,svc,hpa,ingress -n ticket-master
```

### Scaling Phases

The project's evolution introduces infrastructure in successive stages:

```text
 Phase 1          Phase 2          Phase 3          Phase 4
 Core booking --> Redis cache --> CQRS + outbox --> Redis Cluster
 Transactions     Cached reads    Redis Streams    PgBouncer
 Seat locks                       Projections      Shared infrastructure
                                                        |
                                                        v
                   Phase 6                         Phase 5
                   Nginx Ingress <---------------- Kubernetes
                   HTTP routing                    API replicas + HPA
```

| Phase | Focus | Components |
| --- | --- | --- |
| 1 — Booking foundation | Reservation correctness | Core APIs, JWT, Redis seat locks, transactions, active-seat index, simulated payments |
| 2 — Read caching | Reuse frequently requested data | Redis cache-aside movie reads, TTL-based cache storage |
| 3 — CQRS and event delivery | Separate write and read workloads | Command/query Prisma clients, outbox events, Redis Streams, projection worker |
| 4 — Shared data infrastructure | Cluster Redis and pool database connections | Six Redis nodes, cluster initialization, PgBouncer for both PostgreSQL databases |
| 5 — Horizontal API scaling | Run and scale API replicas | Kubernetes Deployments, ClusterIP Service, resource requests, probes, HPA |
| 6 — Ingress routing | Expose the Kubernetes API service | Nginx Ingress routing and proxy configuration |

The current API implementation applies outbox events and cached read-model queries across users, movies, shows, reservations, payments, and notifications.

---

## Project Structure

```text
ticketMaster/
+-- server.js                         API listener
+-- package.json                      Runtime scripts and dependencies
+-- package-lock.json
+-- api.test.js                       Regression suite
+-- Dockerfile                        Shared API/worker image
+-- compose.yaml                      Local infrastructure
+-- prometheus.yml                    Prometheus scrape configuration
+-- README.md
|
+-- src/
|   +-- app.js                        Express app and route mounts
|   +-- worker.js                     Worker entry point
|   +-- config/
|   |   +-- command-prisma.js
|   |   +-- query-prisma.js
|   |   +-- redis.js
|   |   +-- metrics.js
|   +-- controllers/
|   |   +-- command/
|   |   |   +-- user.controller.js
|   |   |   +-- movie.controller.js
|   |   |   +-- shows.controller.js
|   |   |   +-- reservation.controller.js
|   |   |   +-- payment.controller.js
|   |   +-- query/
|   |       +-- user.controller.js
|   |       +-- movie.controller.js
|   |       +-- show.controller.js
|   |       +-- reservation.controller.js
|   |       +-- notification.controller.js
|   +-- events/
|   |   +-- store.js                  Transactional outbox helper
|   |   +-- publish.js                Stream publishing and subscribers
|   |   +-- register.js               Projection registration
|   |   +-- consumer.js               Stream consumption and retries
|   +-- projections/
|   |   +-- movie.projection.js
|   |   +-- api.projection.js
|   +-- workers/
|   |   +-- outbox.worker.js
|   +-- middleware/
|   |   +-- auth.middleware.js
|   |   +-- ratelimit.middleware.js
|   |   +-- metrics.middleware.js
|   +-- routes/
|   |   +-- user.route.js
|   |   +-- movie.route.js
|   |   +-- shows.route.js
|   |   +-- reservation.route.js
|   |   +-- payment.route.js
|   |   +-- notification.route.js
|   |   +-- metric.route.js
|   +-- utils/
|       +-- cache.js
|       +-- seatLock.js
|
+-- prisma/
|   +-- command/
|   |   +-- schema.prisma
|   |   +-- prisma7.config.ts
|   |   +-- migrations/
|   +-- query/
|       +-- schema.prisma
|       +-- prisma7.config.ts
|       +-- migrations/
+-- generated/
|   +-- command/                      Generated command Prisma client
|   +-- query/                        Generated query Prisma client
+-- pgbouncer/
|   +-- command.ini
|   +-- query.ini
+-- docker/
|   +-- nginx.conf                    Standalone Nginx configuration
+-- k8s/
|   +-- namespace.yaml
|   +-- api-deployment.yaml
|   +-- worker-deployment.yaml
|   +-- hpa.yaml
|   +-- ingress.yaml
+-- public/
    +-- admin.html                    Static admin page
```

---

## License

ISC, as declared in [package.json](package.json).

---

**Built with Node.js, Express, PostgreSQL, Prisma, Redis Cluster, and Kubernetes.**
