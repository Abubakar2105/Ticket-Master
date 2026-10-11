# TicketMaster — Scalable Movie Ticket Booking Backend

A movie ticket booking backend built with **Node.js, Express, PostgreSQL, Prisma, and Redis**. This project explores the engineering challenges behind reservation systems, including concurrent requests, temporary seat holds, double-booking prevention, payment workflows, rate limiting, and performance testing.

The goal is to evolve the backend incrementally toward supporting high traffic, using measurements and real bottleneck analysis rather than assuming that a particular architecture can handle 50,000 concurrent users.

> **Current status:** Phase 1 core booking features and reservation tests are implemented. Load testing, performance analysis, and further scalability improvements are the next steps. The 50K+ concurrent-user target has not yet been demonstrated by benchmarks.

## Table of Contents

* [Project Goals](#project-goals)
* [Implemented Features](#implemented-features)
* [Technology Stack](#technology-stack)
* [Architecture](#architecture)
* [Reservation Lifecycle](#reservation-lifecycle)
* [Concurrency and Double-Booking Prevention](#concurrency-and-double-booking-prevention)
* [Rate Limiting](#rate-limiting)
* [Database and Connection Pooling](#database-and-connection-pooling)
* [API Endpoints](#api-endpoints)
* [Getting Started](#getting-started)
* [Environment Variables](#environment-variables)
* [Testing](#testing)
* [Load Testing and Monitoring](#load-testing-and-monitoring)
* [Scaling Roadmap](#scaling-roadmap)
* [Project Structure](#project-structure)
* [Security Considerations](#security-considerations)

## Project Goals

The project is designed to explore how a ticket booking system can remain correct and responsive under concurrent traffic.

Key engineering goals:

* Prevent two users from booking the same seat for the same show.
* Hold seats temporarily while a user proceeds through checkout.
* Release cancelled and expired reservations.
* Handle concurrent requests safely.
* Separate reservation state from payment state.
* Apply rate limits to sensitive endpoints.
* Measure throughput, latency, errors, and resource usage.
* Improve database and Redis performance using benchmarks.
* Prepare the system for multiple API instances and higher traffic.

## Implemented Features

* Movie browsing API.
* Seat availability checks for a specific show.
* Temporary seat reservations.
* Automatic expiration of stale holds when the relevant seat is requested again.
* Reservation cancellation by the reservation owner.
* Simulated payment initiation and verification.
* Authentication and reservation ownership checks.
* Redis-based seat locking.
* PostgreSQL constraint to prevent duplicate active reservations.
* Database transactions for reservation workflows.
* Reservation API rate limiting.
* Automated reservation and payment workflow tests.

**Important:** Payments are simulated. Real payment-provider integration, background expiration jobs, distributed rate limiting, and production-grade horizontal scaling remain future work.

## Technology Stack

| Technology     | Purpose                                 |
| -------------- | --------------------------------------- |
| Node.js        | JavaScript runtime                      |
| Express.js     | HTTP API and routing                    |
| PostgreSQL     | Persistent reservation and payment data |
| Prisma         | Database access and transactions        |
| Redis          | Temporary seat locks                    |
| ioredis        | Redis client                            |
| Docker Compose | Local infrastructure                    |
| Autocannon     | HTTP load testing                       |
| Prometheus     | Metrics collection, when configured     |
| Grafana        | Metrics dashboards, when configured     |

## Architecture

### Current architecture

```text
                  Client
                    |
                    v
              Express API
                    |
           Authentication and
              rate limiting
                    |
          +---------+---------+
          |                   |
          v                   v
   Reservation Logic     Payment Logic
          |                   |
          v                   v
     Redis Lock          PostgreSQL
          |              via Prisma
          +-------> PostgreSQL
                    transactions
```

Redis coordinates access to individual seats. PostgreSQL remains the source of truth for reservation state, with database constraints providing a final layer of protection against duplicate active bookings.

Prisma is used for database operations and transactions. The actual behavior of each transaction depends on its implementation and the database isolation level.

### Future scaling architecture

The following is a target architecture, not the current implementation.

```text
                    Clients
                       |
                       v
                 Load Balancer
                       |
              +--------+--------+
              |        |        |
              v        v        v
             API 1    API 2    API N
              |        |        |
              +--------+--------+
                       |
             +---------+---------+
             |                   |
             v                   v
        Shared Redis       PostgreSQL
                           Connection Pool
                                 |
                      +----------+----------+
                      |                     |
                      v                     v
                 Primary DB          Read Replicas
                 (writes)             (future)

              Background Queue
              (future addition)
```

Possible future improvements include shared rate limiting, read replicas, background workers, caching, and additional API instances. These should be introduced when load tests identify a real need.

## Reservation Lifecycle

```text
                  Available
                      |
                      v
                    HELD
                   /    \
                  v      v
             CANCELLED  EXPIRED
                  |
                  | Seat becomes available
                  |
                  v

       HELD -- successful payment --> CONFIRMED
```

* **HELD:** The seat is temporarily reserved while the user completes checkout.
* **CONFIRMED:** The reservation has been confirmed after the simulated payment succeeds.
* **CANCELLED:** The hold has been cancelled by its owner.
* **EXPIRED:** The temporary hold has expired.

The application currently handles expired holds lazily when the relevant seat is requested again. A background expiration worker is a future improvement.

## Concurrency and Double-Booking Prevention

Preventing double booking requires more than checking whether a seat is available before inserting a reservation. Two requests can pass the same availability check at nearly the same time.

TicketMaster uses multiple layers of protection.

### 1. Redis seat locks

The application uses an atomic Redis command equivalent to:

```text
SET lock:seat:<showId>:<seatNumber> <unique-token> PX 30000 NX
```

* `NX` acquires the lock only if it does not already exist.
* `PX 30000` gives the lock a 30-second lifetime.
* A unique token identifies the request that owns the lock.
* A Lua script releases the lock only if the stored token matches the owner's token.

The token check prevents one request from deleting a lock acquired by another request after the original lock expires.

Redis locks help coordinate competing requests, but they are not a replacement for database constraints.

### 2. PostgreSQL partial unique index

The database enforces one active reservation per show and seat:

```sql
CREATE UNIQUE INDEX "reservations_one_active_seat_per_show"
ON "reservations" ("show_id", "seat_number")
WHERE status IN ('HELD', 'CONFIRMED');
```

This allows historical cancelled and expired reservations while preventing multiple active reservations for the same seat.

The index must be present in the database for the protection to apply.

### 3. Database transactions

Transactions help keep related database changes consistent. Unique constraints remain important because transactions alone do not automatically prevent every race condition.

### 4. Temporary holds

A seat hold has a two-minute application-level duration. The Redis coordination lock has a separate 30-second duration. These serve different purposes:

* The reservation hold represents the checkout window.
* The Redis lock protects a short critical section while the application processes a request.

## Rate Limiting

The reservation API uses rate-limiting middleware to reduce excessive requests to sensitive endpoints.

Rate limiting can help protect against:

* Repeated reservation attempts.
* Automated abuse.
* Excessive API traffic from individual clients.
* Unnecessary load on PostgreSQL and Redis.

### Scaling consideration

If rate-limit counters exist only in an individual Node.js process, each API instance may enforce its own limit. That is not equivalent to a shared limit across all instances.

For a horizontally scaled deployment, consider a Redis-backed rate-limit store.

Also configure trusted proxies correctly when running behind a reverse proxy or load balancer. Incorrect proxy settings can cause client IP addresses to be interpreted incorrectly.

The actual request limit and time window are determined by the project's middleware configuration.

## Database and Connection Pooling

PostgreSQL connections are a finite resource. Opening too many connections can increase overhead and exhaust the database's connection limit.

Prisma manages database connections, but the appropriate pool configuration depends on the Prisma version, database deployment, and application workload.

### Optimization strategy

1. Measure current database connection usage.
2. Inspect slow queries and query plans.
3. Add indexes only when query patterns justify them.
4. Configure connection pooling based on measured demand.
5. Consider PgBouncer or another pooler if connection churn becomes a bottleneck.
6. Calculate the total connection budget across API instances, workers, migrations, and administrative tools.

For example, four API instances with 20 database connections each could consume up to 80 connections, before accounting for other services.

Increasing a connection pool does not automatically increase throughput. It can make performance worse if the database is already saturated.

## API Endpoints

These are the current expected endpoint paths based on the application's route mounts. Confirm the paths against the latest router configuration if you change the mounts.

| Method | Endpoint                      | Purpose                        |
| ------ | ----------------------------- | ------------------------------ |
| GET    | `/movies`                     | Browse movies                  |
| GET    | `/seats/:seat_id?show_id=...` | Check seat availability        |
| POST   | `/seats/reserve`              | Create a temporary reservation |
| POST   | `/seats/reservation/cancel`   | Cancel an eligible reservation |
| GET    | `/seats/reservation/:user_id` | Retrieve a user's reservations |
| POST   | `/payments/initiate`          | Initiate simulated payment     |
| POST   | `/payments/verify`            | Verify simulated payment       |

Protected endpoints require the authentication expected by the application's middleware. Request bodies, authorization requirements, and response formats should be documented alongside the corresponding route implementations as the API evolves.

## Getting Started

### Prerequisites

* Node.js and npm.
* Docker Desktop with Docker Compose.
* PostgreSQL.
* Redis, either through Docker Compose or a local installation.

If PostgreSQL and Redis are already defined in `docker-compose.yml`, you can use those local services rather than installing them separately.

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd ticketMaster
```

Replace `<your-repository-url>` with your repository's actual URL.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root. See the example below and adjust it to match your local database configuration.

### 4. Start the infrastructure

```bash
docker compose up -d
docker compose ps
```

Make sure the required services are running.

### 5. Prepare the database

```bash
npx prisma migrate dev
npx prisma generate
```

If your project uses a different migration workflow or the database already has all migrations applied, follow your existing Prisma setup.

### 6. Start the API

```bash
npm run dev
```

The API is expected to be available at:

```text
http://localhost:3000
```

Verify the configured port in your application if the URL differs.

## Environment Variables

Example `.env` configuration:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/ticketmaster"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="replace_with_a_development_secret"
```

Use the variable names required by your actual application. If your project uses Docker networking, the database hostname and Redis hostname may differ from the local values above.

**Never commit real credentials, production URLs containing secrets, or private API keys.** Keep `.env` out of Git and provide safe placeholders in `.env.example`.

## Testing

Run the reservation workflow tests:

```bash
node test-reservation.js
```

The current reported test result is:

```text
Passed: 16
Failed: 0
```

The tests cover:

* Rejecting unauthenticated and invalid reservation requests.
* Creating a reservation and checking seat availability.
* Enforcing reservation ownership for cancellation and payment verification.
* Releasing cancelled seats.
* Preventing multiple concurrent requests from reserving the same seat.
* Initiating and processing simulated payments.
* Rejecting duplicate payment processing and duplicate initiation.
* Expiring a hold and allowing the seat to be reserved again.
* Preventing users from accessing another user's reservations.

The test suite interacts with the database. Run it against a development or dedicated test database, not production.

## Load Testing and Monitoring

Load testing helps establish a baseline and identify bottlenecks before making scaling claims.

### 1. Start the API

In one terminal:

```powershell
npm run dev
```

Ensure PostgreSQL and Redis are running as well.

### 2. Baseline test

In a second terminal:

```powershell
npx autocannon -c 10 -d 30 http://localhost:3000/movies
```

This runs a 30-second test with 10 concurrent connections.

### 3. Increase concurrency gradually

Medium load:

```powershell
npx autocannon -c 50 -d 30 http://localhost:3000/movies
```

Higher load:

```powershell
npx autocannon -c 100 -d 30 http://localhost:3000/movies
```

Do not jump directly to very high concurrency. Increase the load gradually and stop if the application or machine becomes unstable.

### 4. What to measure

| Metric                              | What it tells you                |
| ----------------------------------- | -------------------------------- |
| Requests per second                 | HTTP throughput                  |
| Median latency (p50)                | Typical request response time    |
| High-percentile latency (p97.5/p99) | Slow requests and tail latency   |
| Errors and timeouts                 | Reliability under load           |
| Node.js CPU and memory              | Application resource usage       |
| PostgreSQL connections              | Database connection pressure     |
| Query latency                       | Database performance             |
| Redis latency and errors            | Locking and cache-service health |

### 5. Grafana and Prometheus

If Prometheus is scraping your Express metrics endpoint, use Grafana to visualize request throughput, response latency, and error rates.

Example PromQL for total request rate:

```promql
sum(rate(http_requests_total[5m]))
```

Example for HTTP 5xx error percentage:

```promql
100 *
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
clamp_min(sum(rate(http_requests_total[5m])), 1e-9)
```

These queries depend on the actual metric names and labels exposed by your application. If a panel shows no data, first inspect the available metrics in Prometheus and replace the example names with the names your application exports.

**Important:** Testing `/movies` measures that endpoint's performance. It does not prove that seat reservations or payments can handle the same traffic. Reservation tests must also account for lock contention, database writes, and competing requests for the same seats.

## Scaling Roadmap

| Phase   | Goal                                                                                                                 | Status             |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Phase 1 | Core APIs, reservations, temporary holds, Redis locks, database constraints, simulated payments, cancellation, tests | Completed          |
| Phase 2 | Establish load-test baselines and build useful Grafana dashboards                                                    | Next / in progress |
| Phase 3 | Analyze slow queries, indexes, and Prisma/PostgreSQL connection pooling                                              | Planned            |
| Phase 4 | Improve shared rate limiting, caching, and idempotency                                                               | Planned            |
| Phase 5 | Add background workers for hold expiration and asynchronous tasks                                                    | Planned            |
| Phase 6 | Run multiple API instances behind a load balancer and test failure scenarios                                         | Planned            |
| Phase 7 | Evaluate read replicas, queues, and event-driven workflows where measurements justify them                           | Future             |

The purpose of each phase is to identify a limitation, implement a targeted improvement, and measure whether it helped.

## Project Structure

A simplified view of the expected structure:

```text
ticketMaster/
├── src/
│   ├── config/
│   │   └── redis.js
│   ├── controllers/
│   │   ├── reservation.controller.js
│   │   ├── payment.controller.js
│   │   └── cancellation.controller.js
│   ├── middleware/
│   │   └── auth.middleware.js
│   ├── routes/
│   │   └── ...
│   └── utils/
│       └── seatLock.js
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test-reservation.js
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Your actual folder and filename structure may differ. Update this tree as the repository changes.

## Security Considerations

Before using the project in production:

* Replace simulated payments with a payment provider and verify payments server-side.
* Never trust a client-supplied payment result as proof of a successful transaction.
* Calculate prices on the server rather than accepting authoritative amounts from clients.
* Add idempotency to payment and reservation operations where appropriate.
* Keep authentication secrets and database credentials out of version control.
* Validate all request parameters and bodies.
* Enforce authorization checks for reservations and user data.
* Configure trusted proxies and shared rate limiting correctly.
* Handle Redis and database failures explicitly.
* Run load tests against a controlled environment, not production without authorization.
* Review cancellation, refund, and payment reconciliation behavior before supporting real payments.

## Learning Philosophy

This project is being built incrementally to understand real backend engineering trade-offs:

**Implement → Test correctness → Measure performance → Find bottlenecks → Optimize → Test again.**

The target is to build a reliable booking system and develop a defensible understanding of how it scales—not simply to claim support for a large number of users.

---

Built as a backend engineering learning project, one phase at a time.
