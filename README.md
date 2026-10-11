# TicketMaster — Movie Ticket Booking Backend

A movie ticket booking backend built with **Node.js, Express, PostgreSQL, Prisma, and Redis**. This project focuses on the backend engineering fundamentals behind a booking system: reservation management, temporary seat holds, concurrency control, simulated payments, and preventing double bookings.

## Features

* **Movie browsing API** — retrieve available movies.
* **Seat availability** — check whether a seat is available for a particular show.
* **Seat reservations** — temporarily hold seats for a limited time.
* **Redis distributed locking** — prevent simultaneous requests from processing the same seat at once.
* **Database-level concurrency protection** — a PostgreSQL partial unique index prevents multiple active reservations for the same seat and show.
* **Reservation expiration** — expired holds are handled when another booking attempt is made.
* **Payment simulation** — initiate payments and simulate successful or failed payment outcomes.
* **Reservation confirmation** — confirm a reservation following successful simulated payment.
* **Cancellation** — cancel eligible held reservations and release seats.
* **Authentication and authorization** — protect reservation operations and enforce ownership checks.
* **Automated API tests** — test important booking, payment, concurrency, and authorization scenarios.

## Tech Stack

| Technology           | Purpose                              |
| -------------------- | ------------------------------------ |
| Node.js              | JavaScript runtime                   |
| Express.js           | REST API framework                   |
| PostgreSQL           | Relational database                  |
| Prisma ORM           | Database queries and transactions    |
| Redis                | Temporary seat locks                 |
| ioredis              | Redis client                         |
| Docker Compose       | Local service management             |
| Autocannon           | HTTP load testing                    |
| Prometheus & Grafana | Metrics collection and visualization |

## How Seat Reservations Work

1. A user selects a movie show and seat.
2. The backend validates the request and authenticates the user.
3. Redis attempts to acquire a short-lived lock for the selected seat.
4. A database transaction checks the show and existing active reservations.
5. The backend creates a temporary `HELD` reservation with an expiration time.
6. The user initiates a simulated payment.
7. If payment succeeds before the hold expires, the reservation becomes `CONFIRMED`.
8. If the user cancels an eligible hold or it expires, the seat becomes available again.

### Preventing Double Bookings

The project uses multiple layers of protection:

* **Redis lock:** coordinates concurrent requests for the same seat.
* **PostgreSQL unique index:** enforces the rule that only one `HELD` or `CONFIRMED` reservation can exist for the same show and seat.
* **Database transactions:** keep related reservation and payment updates consistent.
* **Conditional updates:** prevent reservations or payments from being processed repeatedly.

Redis locking alone is not sufficient. The database constraint is an important final safeguard.

## API Endpoints

The following endpoints reflect the current implemented routes. Exact request fields may depend on the controller implementation.

| Method | Endpoint                      | Purpose                             |
| ------ | ----------------------------- | ----------------------------------- |
| `GET`  | `/movies`                     | Browse movies                       |
| `GET`  | `/seats/:seat_id?show_id=...` | Check seat availability             |
| `POST` | `/seats/reserve`              | Hold a seat                         |
| `POST` | `/seats/reservation/cancel`   | Cancel an eligible held reservation |
| `GET`  | `/seats/reservation/:user_id` | Retrieve a user's reservations      |
| `POST` | `/payments/initiate`          | Initiate simulated payment          |
| `POST` | `/payments/verify`            | Process a simulated payment result  |

Reservation and payment endpoints require authentication where configured. A user cannot access another user's reservations or cancel another user's hold.

> **Important:** Payment processing is simulated for development. The payment verification endpoint must not trust a client-supplied success result in production. A real payment provider and trusted server-side verification or webhook flow are required.

## Getting Started

### Prerequisites

Install the following:

* Node.js and npm
* PostgreSQL
* Docker Desktop with Docker Compose
* Git

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd ticketMaster
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/ticketmaster"
REDIS_URL="redis://localhost:6379"
```

Add the authentication secret and any other variables required by your application.

**Never commit `.env` files, database credentials, authentication secrets, or access tokens to GitHub.**

### 4. Start Redis

```bash
docker compose up -d
```

Verify that the required containers are running:

```bash
docker compose ps
```

### 5. Set up the database

Run the Prisma commands appropriate for your project:

```bash
npx prisma migrate dev
npx prisma generate
```

If the database is already configured and migrated, you may only need to regenerate the Prisma client after schema changes.

Ensure the partial unique index for active reservations is present in PostgreSQL.

### 6. Start the server

Use the development script defined in `package.json`:

```bash
npm run dev
```

The API is expected to run at:

```text
http://localhost:3000
```

## Testing

The project includes a standalone API test script, `test-reservation.js`, using Node.js's built-in `fetch()` functionality.

Run it with:

```bash
node test-reservation.js
```

The current test suite has **16 passing tests and 0 failures**.

The suite covers:

* Unauthenticated and invalid reservation requests
* Creating and checking held reservations
* Cancellation and seat availability
* Unauthorized cancellation attempts
* Concurrent requests for the same seat
* Payment initiation and ownership checks
* Successful and failed simulated payments
* Duplicate payment processing
* Expired holds and rebooking
* Reservation ownership and access control

The tests require a running API, a configured development database, a future show, and valid test-user credentials and tokens.

**Run the tests against a development database only.** They create and modify reservations and payment records.

## Load Testing

Autocannon can be used to measure API throughput and latency.

Start with a baseline test:

```bash
npx autocannon -c 10 -d 30 http://localhost:3000/movies
```

Increase concurrency gradually:

```bash
npx autocannon -c 50 -d 30 http://localhost:3000/movies
npx autocannon -c 100 -d 30 http://localhost:3000/movies
```

Compare requests per second, latency percentiles, timeouts, and errors between runs. These are initial load tests, not proof of capacity for 50,000 concurrent users.

## Project Status

**Phase 1 — Core Booking Backend: Completed**

Implemented and tested the core reservation flow, temporary seat holds, concurrency safeguards, simulated payments, cancellation, and authorization checks.

Performance testing and further scalability work can build on this foundation.

## Future Improvements

* Integrate a real payment provider with trusted payment verification.
* Add background jobs for reservation expiration if operational requirements justify them.
* Expand load testing to reservation and payment endpoints.
* Monitor database connection pools and query performance.
* Add structured logging, tracing, and more detailed metrics.
* Introduce rate limiting and production-ready error handling.
* Evaluate horizontal scaling and resilience under sustained load.

## Learning Goals

This project is being developed to understand practical backend engineering concepts, including REST APIs, transactions, concurrency, distributed locking, database constraints, payment workflows, authorization, automated testing, and performance monitoring.

---

**Built as a backend engineering learning project.**
