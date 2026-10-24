const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const http = require("node:http");

const sourceRoot = path.join(__dirname, "src") + path.sep;

function load(file, mocks = {}) {
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(sourceRoot)) delete require.cache[filename];
  }
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent).replace(/\\/g, "/").replace(/\.js$/, "");
    const dependency = Object.keys(mocks).find((name) => request === name || request.endsWith(`/${name}`) || resolved.endsWith(`/${name}`));
    if (dependency) return mocks[dependency];
    if (resolved.endsWith("/config/redis") || resolved.endsWith("/config/command-prisma") || resolved.endsWith("/config/query-prisma")) {
      throw new Error(`Unmocked infrastructure: ${resolved}`);
    }
    return original.call(this, request, parent, isMain);
  };
  try {
    return require(path.join(__dirname, file));
  } finally {
    Module._load = original;
  }
}

async function invoke(handler, req = {}) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ params: {}, query: {}, body: {}, ...req }, res);
  return res;
}

function cacheFixture(initial = null) {
  const calls = [];
  return {
    calls,
    async get(key) { calls.push(["get", key]); return initial; },
    async set(key, ttl, data) { calls.push(["set", key, ttl, data]); },
    async del(key) { calls.push(["del", key]); },
  };
}

function bookingFixture({ expired = false, payment = true, reservationStatus = "HELD", paymentStatus = "PENDING" } = {}) {
  const now = new Date();
  const state = {
    reservation: {
      id: "r1", userId: "u1", showId: "s1", seatNumber: "A1", status: reservationStatus,
      expiresAt: new Date(now.getTime() + (expired ? -10000 : 120000)), createdAt: now, updatedAt: now,
    },
    payment: payment ? {
      id: "p1", reservationId: "r1", userId: "u1", amount: "15.50", status: paymentStatus,
      provider: "SIMULATED", transactionId: null, createdAt: now,
    } : null,
    notifications: [], events: [],
  };
  const calls = [];
  const show = {
    id: "s1", movieId: "m1", theater: "Main", startTime: new Date(now.getTime() + 3600000),
    endTime: new Date(now.getTime() + 9000000), createdAt: now,
    movie: { id: "m1", name: "Movie", genre: "Drama", duration: 90, createdAt: now },
  };
  const copy = (value) => value == null ? null : structuredClone(value);
  const tx = {
    reservation: {
      async findUnique(args) {
        if (!state.reservation || args.where.id !== state.reservation.id) return null;
        const result = copy(state.reservation);
        if (args.include?.payment) result.payment = copy(state.payment);
        if (args.include?.show) result.show = copy(show);
        return result;
      },
      async findMany() {
        return state.reservation?.status === "HELD" && state.reservation.expiresAt <= new Date()
          ? [copy(state.reservation)] : [];
      },
      async findFirst() {
        return state.reservation && (state.reservation.status === "CONFIRMED" ||
          (state.reservation.status === "HELD" && state.reservation.expiresAt > new Date()))
          ? copy(state.reservation) : null;
      },
      async update({ data }) {
        Object.assign(state.reservation, data, { updatedAt: new Date() });
        return copy(state.reservation);
      },
      async updateMany({ where, data }) {
        if (!state.reservation || state.reservation.id !== where.id ||
          (where.status && state.reservation.status !== where.status) ||
          (where.userId && state.reservation.userId !== where.userId) ||
          (where.expiresAt?.gt && state.reservation.expiresAt <= where.expiresAt.gt) ||
          (where.expiresAt?.lte && state.reservation.expiresAt > where.expiresAt.lte)) return { count: 0 };
        Object.assign(state.reservation, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      async create({ data }) {
        await Promise.resolve();
        state.reservation = { id: "r2", ...data, createdAt: new Date(), updatedAt: new Date() };
        return copy(state.reservation);
      },
    },
    payment: {
      async findUnique(args) {
        const match = state.payment && (args.where.id === state.payment.id || args.where.reservationId === state.payment.reservationId);
        if (!match) return null;
        const result = copy(state.payment);
        if (args.include?.reservation || args.select?.reservation) result.reservation = copy(state.reservation);
        return result;
      },
      async create({ data }) {
        state.payment = { id: "p1", ...data, transactionId: null, createdAt: new Date() };
        return copy(state.payment);
      },
      async update({ data }) { Object.assign(state.payment, data); return copy(state.payment); },
      async updateMany({ where, data }) {
        if (!state.payment || state.payment.id !== where.id || state.payment.status !== where.status) return { count: 0 };
        Object.assign(state.payment, data);
        return { count: 1 };
      },
    },
    show: { async findUnique() { return copy(show); } },
    notification: {
      async create({ data }) {
        const saved = { id: "n1", ...data, status: "PENDING", createdAt: new Date() };
        state.notifications.push(saved);
        return copy(saved);
      },
    },
    outboxEvent: { async create({ data }) { state.events.push(copy(data)); return data; } },
  };
  const command = {
    ...tx,
    async $transaction(callback, options) {
      calls.push(["transaction", options]);
      const snapshot = copy(state);
      try { return await callback(tx); }
      catch (error) { Object.assign(state, snapshot); throw error; }
    },
  };
  const mocks = {
    "config/command-prisma": command,
    "config/query-prisma": {},
    "utils/cache": cacheFixture(),
    "utils/seatLock": {
      async withSeatLock(showId, seatNumber, callback) {
        calls.push(["lock", showId, seatNumber]);
        return callback();
      },
    },
  };
  return { state, calls, tx, command, mocks, show };
}

for (const [name, file, handler, model, key, ttl] of [
  ["movies", "src/controllers/query/movie.controller.js", "getMovies", "movie", "movies:all", 60],
  ["shows", "src/controllers/query/show.controller.js", "getShows", "show", "shows:all", 30],
  ["users", "src/controllers/query/user.controller.js", "getUsers", "user", "users:all", 60],
]) {
  test(`${name} cache hits and misses return the same list shape, including empty lists`, async () => {
    for (const rows of [[], [{ id: "item1" }]]) {
      const missCache = cacheFixture();
      const query = { [model]: { async findMany(args) { assert.equal(args.include, undefined); return rows; } } };
      const miss = await invoke(load(file, { "config/query-prisma": query, "utils/cache": missCache })[handler]);
      const hitCache = cacheFixture(rows);
      const hit = await invoke(load(file, { "config/query-prisma": {}, "utils/cache": hitCache })[handler]);
      assert.equal(miss.statusCode, 200);
      assert.deepEqual(hit.body, miss.body);
      assert.deepEqual(miss.body, { count: rows.length, [name]: rows });
      assert.deepEqual(missCache.calls[1], ["set", key, ttl, rows]);
      assert.deepEqual(hitCache.calls, [["get", key]]);
    }
  });
}

for (const [name, file, handler, param] of [
  ["profiles", "src/controllers/query/user.controller.js", "getUserById", "id"],
  ["reservations", "src/controllers/query/reservation.controller.js", "getUserReservations", "user_id"],
  ["notifications", "src/controllers/query/notification.controller.js", "getUserNotifications", "user_id"],
]) {
  test(`${name} enforce ownership before cache access and allow verified admins`, async () => {
    const cache = cacheFixture(name === "profiles" ? { id: "u2" } : []);
    const controllers = load(file, {
      "config/command-prisma": {}, "config/query-prisma": {}, "utils/cache": cache,
      "utils/seatLock": {}, "events/store": {},
    });
    const anonymous = await invoke(controllers[handler], { params: { [param]: "u2" } });
    assert.equal(anonymous.statusCode, 401);
    const forbidden = await invoke(controllers[handler], { params: { [param]: "u2" }, user: { id: "u1", is_admin: false } });
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(cache.calls, []);
    const own = await invoke(controllers[handler], { params: { [param]: "u2" }, user: { id: "u2", is_admin: false } });
    assert.equal(own.statusCode, 200);
    const admin = await invoke(controllers[handler], { params: { [param]: "u2" }, user: { id: "admin", is_admin: true } });
    assert.equal(admin.statusCode, 200);
    assert.equal(cache.calls.length, 2);
  });
}

test("registration hashes passwords and exposes only public fields in responses and outbox", async () => {
  const publicUser = { id: "u1", username: "name", email: "a@example.com", is_admin: false, createdAt: new Date() };
  const events = [];
  let savedData;
  const tx = {
    user: { async create({ data, select }) { savedData = data; assert.equal(select.password, undefined); return publicUser; } },
    outboxEvent: { async create({ data }) { events.push(data); } },
  };
  const command = { async $transaction(callback) { return callback(tx); } };
  const { registerUser } = load("src/controllers/command/user.controller.js", {
    "config/command-prisma": command,
    bcryptjs: { async hash(password, rounds) { assert.equal(password, "secret"); assert.equal(rounds, 12); return "hashed"; } },
    jsonwebtoken: {},
  });
  const response = await invoke(registerUser, { body: { username: " name ", email: " a@example.com ", password: "secret", is_admin: true } });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(savedData, { username: "name", email: "a@example.com", password: "hashed", is_admin: false });
  assert.equal(response.body.user.password, undefined);
  assert.equal(events[0].payload.password, undefined);
  assert.equal(events[0].eventType, "user-created");
  assert.equal(events[0].payload.createdAt, publicUser.createdAt.toISOString());
});

test("registration rejects overlong bcrypt passwords by UTF-8 byte count", async () => {
  const { registerUser } = load("src/controllers/command/user.controller.js", {
    "config/command-prisma": {}, "events/store": {}, bcryptjs: {}, jsonwebtoken: {},
  });
  for (const password of ["a".repeat(73), "é".repeat(37)]) {
    const response = await invoke(registerUser, { body: { username: "name", email: "a@example.com", password } });
    assert.equal(response.statusCode, 400);
  }
});

test("duplicate registration returns 409", async () => {
  const { registerUser } = load("src/controllers/command/user.controller.js", {
    "config/command-prisma": { async $transaction() { throw Object.assign(new Error("duplicate"), { code: "P2002" }); } },
    "events/store": {}, bcryptjs: { async hash() { return "hash"; } }, jsonwebtoken: {},
  });
  assert.equal((await invoke(registerUser, { body: { username: "name", email: "a@example.com", password: "secret" } })).statusCode, 409);
});

test("login uses command database without caching or exposing password", async () => {
  const { loginUser } = load("src/controllers/command/user.controller.js", {
    "config/command-prisma": { user: { async findUnique({ where }) {
      assert.equal(where.email, "a@example.com");
      return { id: "u1", username: "name", email: where.email, password: "hash", is_admin: false };
    } } },
    "events/store": {}, bcryptjs: { async compare() { return true; } },
    jsonwebtoken: { sign(payload) { assert.deepEqual(payload, { id: "u1" }); return "token"; } },
  });
  const response = await invoke(loginUser, { body: { email: " a@example.com ", password: "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.token, "token");
  assert.equal(response.body.user.password, undefined);
});

test("show creation uses the movie duration and emits its event inside the transaction", async () => {
  const events = [];
  const movie = { id: "m1", duration: 87 };
  let saved;
  const tx = {
    movie: { async findUnique() { return movie; } },
    show: { async create({ data }) { saved = { id: "s1", ...data, movie }; return saved; } },
    outboxEvent: { async create({ data }) { events.push(data); } },
  };
  const { createShow } = load("src/controllers/command/shows.controller.js", {
    "config/command-prisma": { async $transaction(callback) { return callback(tx); } },
  });
  const start = new Date(Date.now() + 3600000);
  const response = await invoke(createShow, { body: { movie_id: "m1", theater: "Main", start_time: start.toISOString() } });
  assert.equal(response.statusCode, 201);
  assert.equal(saved.endTime - saved.startTime, 87 * 60000);
  assert.equal(events[0].eventType, "show-created");
  assert.equal(events[0].aggregateId, "s1");
});

test("movie creation rejects malformed duration without writing", async () => {
  const { createMovie } = load("src/controllers/command/movie.controller.js", { "config/command-prisma": {}, "events/store": {} });
  for (const duration of [0, -1, 1.5, "90", null, 2147483648]) {
    assert.equal((await invoke(createMovie, { body: { name: "Movie", genre: "Drama", duration } })).statusCode, 400);
  }
});

test("reserving a seat awaits the saved record before emitting outbox and uses a bounded seat lock", async () => {
  const fixture = bookingFixture({ payment: false });
  fixture.state.reservation = null;
  const { reserveSeat } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const response = await invoke(reserveSeat, { user: { id: "u1" }, body: { show_id: " s1 ", seat_id: " a1 " } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.reservation.id, "r2");
  assert.deepEqual(fixture.calls[0], ["lock", "s1", "A1"]);
  assert.deepEqual(fixture.calls[1], ["transaction", { maxWait: 5000, timeout: 5000 }]);
  assert.equal(fixture.state.events[0].aggregateId, "r2");
  assert.equal(fixture.state.events[0].payload.id, "r2");
  assert.equal(typeof fixture.state.events[0].payload.expiresAt, "string");
});

test("rebooking expires the old hold and fails its payment with transactional events", async () => {
  const fixture = bookingFixture({ expired: true });
  const { reserveSeat } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const response = await invoke(reserveSeat, { user: { id: "u1" }, body: { show_id: "s1", seat_id: "A1" } });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["reservation-updated", "payment-updated", "reservation-created"]);
  assert.equal(fixture.state.events[0].payload.status, "EXPIRED");
  assert.equal(fixture.state.payment.status, "FAILED");
});

test("reserving an occupied seat returns 409 without committed events", async () => {
  const fixture = bookingFixture();
  const { reserveSeat } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  assert.equal((await invoke(reserveSeat, { user: { id: "u1" }, body: { show_id: "s1", seat_id: "A1" } })).statusCode, 409);
  assert.deepEqual(fixture.state.events, []);
});

test("seat availability reads authoritative command state without cache", async () => {
  const fixture = bookingFixture({ expired: true });
  const { checkSeatAvailability } = load("src/controllers/query/reservation.controller.js", fixture.mocks);
  const response = await invoke(checkSeatAvailability, { params: { seat_id: " a1 " }, query: { show_id: "s1" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.seat_number, "A1");
  assert.deepEqual(fixture.mocks["utils/cache"].calls, []);
});

test("cancelling a hold fails pending payment and emits both state changes", async () => {
  const fixture = bookingFixture();
  const { cancelReservation } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const response = await invoke(cancelReservation, { user: { id: "u1" }, body: { reservation_id: "r1" } });
  assert.equal(response.statusCode, 200);
  assert.equal(fixture.state.reservation.status, "CANCELLED");
  assert.equal(fixture.state.payment.status, "FAILED");
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["reservation-updated", "payment-updated"]);
  assert.deepEqual(fixture.calls[0], ["lock", "s1", "A1"]);
});

test("cancelling an expired hold commits expiration events and returns 409", async () => {
  const fixture = bookingFixture({ expired: true });
  const { cancelReservation } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const response = await invoke(cancelReservation, { user: { id: "u1" }, body: { reservation_id: "r1" } });
  assert.equal(response.statusCode, 409);
  assert.equal(fixture.state.reservation.status, "EXPIRED");
  assert.equal(fixture.state.events.length, 2);
});

test("reservation read model joins payments and caches the composite response", async () => {
  const cache = cacheFixture();
  const { getUserReservations } = load("src/controllers/query/reservation.controller.js", {
    "config/command-prisma": {}, "utils/seatLock": {}, "events/store": {}, "utils/cache": cache,
    "config/query-prisma": {
      reservation: { async findMany() { return [{ id: "r1", userId: "u1" }]; } },
      payment: { async findMany({ where }) { assert.deepEqual(where.reservationId.in, ["r1"]); return [{ id: "p1", reservationId: "r1" }]; } },
    },
  });
  const response = await invoke(getUserReservations, { user: { id: "u1" }, params: { user_id: "u1" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.reservations[0].payment.id, "p1");
  assert.deepEqual(cache.calls[1], ["set", "reservations:user:u1", 30, response.body.reservations]);
});

test("payment initiation rejects malformed amounts before database access", async () => {
  const { initiatePayment } = load("src/controllers/command/payment.controller.js", {
    "config/command-prisma": {}, "utils/seatLock": {}, "events/store": {},
  });
  for (const amount of [true, [], {}, null, "", "1.001", "1e2", -1, 0, Infinity, 100000000]) {
    assert.equal((await invoke(initiatePayment, { user: { id: "u1" }, body: { reservation_id: "r1", amount } })).statusCode, 400);
  }
});

test("payment initiation emits a complete payment-created event under the seat lock", async () => {
  const fixture = bookingFixture({ payment: false });
  const { initiatePayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(initiatePayment, { user: { id: "u1" }, body: { reservation_id: "r1", amount: "15.50" } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.payment.provider, "SIMULATED");
  assert.deepEqual(fixture.calls[0], ["lock", "s1", "A1"]);
  assert.deepEqual(fixture.calls[1], ["transaction", { maxWait: 5000, timeout: 5000 }]);
  assert.equal(fixture.state.events[0].eventType, "payment-created");
  assert.equal(fixture.state.events[0].payload.userId, "u1");
  assert.equal(typeof fixture.state.events[0].payload.createdAt, "string");
});

test("payment initiation rejects another user's reservation", async () => {
  const fixture = bookingFixture({ payment: false });
  const { initiatePayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  assert.equal((await invoke(initiatePayment, { user: { id: "u2" }, body: { reservation_id: "r1", amount: 15 } })).statusCode, 403);
  assert.equal(fixture.state.payment, null);
  assert.deepEqual(fixture.state.events, []);
});

test("payment initiation expires stale holds and emits the committed state change", async () => {
  const fixture = bookingFixture({ payment: false, expired: true });
  const { initiatePayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  assert.equal((await invoke(initiatePayment, { user: { id: "u1" }, body: { reservation_id: "r1", amount: 15 } })).statusCode, 409);
  assert.equal(fixture.state.reservation.status, "EXPIRED");
  assert.equal(fixture.state.events[0].eventType, "reservation-updated");
});

test("payment handlers propagate seat-lock unavailability", async () => {
  const fixture = bookingFixture();
  fixture.mocks["utils/seatLock"] = { async withSeatLock() { throw Object.assign(new Error("Reservation service is unavailable"), { statusCode: 503 }); } };
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  assert.equal((await invoke(verifyPayment, { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "SUCCESS" } })).statusCode, 503);
  assert.deepEqual(fixture.state.events, []);
});

test("successful payment verification commits confirmation, notification, and all outbox events", async () => {
  const fixture = bookingFixture();
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(verifyPayment, { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "SUCCESS" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.reservation_status, "CONFIRMED");
  assert.equal(fixture.state.reservation.status, "CONFIRMED");
  assert.equal(fixture.state.payment.status, "SUCCESS");
  assert.equal(fixture.state.notifications[0].userId, "u1");
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["payment-updated", "reservation-updated", "notification-created"]);
});

test("failed payment verification retains a valid hold and emits payment-updated", async () => {
  const fixture = bookingFixture();
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(verifyPayment, { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "FAILED" } });
  assert.equal(response.statusCode, 200);
  assert.equal(fixture.state.reservation.status, "HELD");
  assert.equal(fixture.state.payment.status, "FAILED");
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["payment-updated"]);
});

test("successful client result for an expired hold fails payment and emits both committed changes", async () => {
  const fixture = bookingFixture({ expired: true });
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(verifyPayment, { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "SUCCESS" } });
  assert.equal(response.statusCode, 409);
  assert.equal(fixture.state.reservation.status, "EXPIRED");
  assert.equal(fixture.state.payment.status, "FAILED");
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["reservation-updated", "payment-updated"]);
});

test("repeated verification returns 409 without duplicate notifications or events", async () => {
  const fixture = bookingFixture();
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const request = { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "SUCCESS" } };
  assert.equal((await invoke(verifyPayment, request)).statusCode, 200);
  assert.equal((await invoke(verifyPayment, request)).statusCode, 409);
  assert.equal(fixture.state.notifications.length, 1);
  assert.equal(fixture.state.events.length, 3);
});

test("failed payment status update rolls back reservation confirmation", async () => {
  const fixture = bookingFixture();
  fixture.tx.payment.updateMany = async () => ({ count: 0 });
  const { verifyPayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(verifyPayment, { user: { id: "u1" }, body: { payment_id: "p1", payment_result: "SUCCESS" } });
  assert.equal(response.statusCode, 409);
  assert.equal(fixture.state.reservation.status, "HELD");
  assert.equal(fixture.state.payment.status, "PENDING");
  assert.deepEqual(fixture.state.events, []);
  assert.deepEqual(fixture.state.notifications, []);
});

test("outbox append uses eventType and JSON-safe dates and decimals", async () => {
  let saved;
  const { append } = load("src/events/store.js", { "config/command-prisma": {} });
  const date = new Date("2026-10-25T00:00:00.000Z");
  await append({ eventType: "payment-created", aggregateId: "p1", payload: {
    createdAt: date, amount: { toJSON() { return "15.50"; } },
  } }, { outboxEvent: { async create({ data }) { saved = data; } } });
  assert.deepEqual(saved, { eventType: "payment-created", aggregateId: "p1", status: "PENDING", payload: { createdAt: date.toISOString(), amount: "15.50" } });
});

test("movie projection preserves original creation time and invalidates cache after upsert", async () => {
  const order = [];
  const createdAt = "2026-10-20T00:00:00.000Z";
  const { projectMovieCreated } = load("src/projections/movie.projection.js", {
    "config/query-prisma": { movie: { async upsert({ create }) { assert.equal(create.createdAt.toISOString(), createdAt); order.push("upsert"); } } },
    "utils/cache": { async del(key) { order.push(key); } },
  });
  await projectMovieCreated({ payload: { id: "m1", name: "Movie", genre: "Drama", duration: 90, createdAt } });
  assert.deepEqual(order, ["upsert", "movies:all"]);
});

test("user, show, and notification projections upsert command snapshots and invalidate correct caches", async () => {
  const order = [];
  const fixture = bookingFixture();
  const user = { id: "u1", username: "name", email: "a@example.com", is_admin: false, createdAt: new Date() };
  const notification = { id: "n1", userId: "u1", message: "Confirmed", type: "PAYMENT_SUCCESS", status: "PENDING", createdAt: new Date() };
  const query = {
    user: { async upsert({ create }) { assert.deepEqual(create, user); assert.equal(create.password, undefined); order.push("user"); } },
    show: { async upsert({ create }) { assert.equal(create.movieName, "Movie"); assert.equal(create.totalSeats, undefined); order.push("show"); } },
    notification: { async upsert({ create }) { assert.deepEqual(create, notification); order.push("notification"); } },
  };
  const projections = load("src/projections/api.projection.js", {
    "config/command-prisma": {
      user: { async findUnique({ select }) { assert.equal(select.password, undefined); return user; } },
      show: { async findUnique() { return fixture.show; } },
      notification: { async findUnique() { return notification; } },
    },
    "config/query-prisma": query, "utils/cache": { async del(key) { order.push(key); } },
  });
  await projections.projectUserCreated({ aggregateId: "u1" });
  await projections.projectShowCreated({ aggregateId: "s1" });
  await projections.projectNotificationCreated({ aggregateId: "n1" });
  assert.deepEqual(order, ["user", "users:all", "user:u1", "show", "shows:all", "notification", "notifications:user:u1"]);
});

test("reservation and payment projections serialize current snapshots and invalidate cache only after commit", async () => {
  const fixture = bookingFixture({ reservationStatus: "CONFIRMED", paymentStatus: "SUCCESS" });
  const order = [];
  const queryTx = {
    async $queryRaw(strings, key) { assert.equal(key, "reservation:r1"); order.push("lock"); },
    reservation: { async upsert({ create }) { assert.equal(create.status, "CONFIRMED"); order.push("reservation"); } },
    payment: { async upsert({ create }) { assert.equal(create.status, "SUCCESS"); assert.equal(create.amount, "15.50"); order.push("payment"); } },
  };
  const query = { async $transaction(callback) { order.push("begin"); const result = await callback(queryTx); order.push("commit"); return result; } };
  const projections = load("src/projections/api.projection.js", {
    "config/command-prisma": fixture.command, "config/query-prisma": query,
    "utils/cache": { async del(key) { order.push(key); } },
  });
  await projections.projectReservationChanged({ aggregateId: "r1", payload: { status: "HELD" } });
  await projections.projectReservationChanged({ aggregateId: "r1", payload: { status: "HELD" } });
  await projections.projectPaymentChanged({ aggregateId: "p1", payload: { status: "PENDING" } });
  const one = ["begin", "lock", "reservation", "payment", "commit", "reservations:user:u1"];
  assert.deepEqual(order, [...one, ...one, ...one]);
});

test("event subscriber registry handles every emitted API event type", () => {
  const registered = [];
  const { setupEventSubscribers } = load("src/events/register.js", {
    "events/publish": { subscribe(name, handler) { assert.equal(typeof handler, "function"); registered.push(name); } },
    "config/command-prisma": {}, "config/query-prisma": {}, "utils/cache": {},
  });
  setupEventSubscribers();
  for (const name of ["movie-created", "user-created", "show-created", "reservation-created", "reservation-updated", "payment-created", "payment-updated", "notification-created"]) {
    assert.ok(registered.includes(name), `${name} is registered`);
  }
});

test("notification cache misses read only the query database and preserve empty lists", async () => {
  const cache = cacheFixture();
  const { getUserNotifications } = load("src/controllers/query/notification.controller.js", {
    "config/query-prisma": { notification: { async findMany({ where }) { assert.deepEqual(where, { userId: "u1" }); return []; } } },
    "utils/cache": cache,
  });
  const response = await invoke(getUserNotifications, { user: { id: "u1" }, params: { user_id: "u1" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { count: 0, notifications: [] });
  assert.deepEqual(cache.calls[1], ["set", "notifications:user:u1", 60, []]);
});

test("cancellation denies other users before acquiring a seat lock", async () => {
  const fixture = bookingFixture();
  const { cancelReservation } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const response = await invoke(cancelReservation, { user: { id: "u2" }, body: { reservation_id: "r1" } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.state.events, []);
});

test("expired payment initiation fails an existing pending payment transactionally", async () => {
  const fixture = bookingFixture({ expired: true });
  const { initiatePayment } = load("src/controllers/command/payment.controller.js", fixture.mocks);
  const response = await invoke(initiatePayment, { user: { id: "u1" }, body: { reservation_id: "r1", amount: "15.50" } });
  assert.equal(response.statusCode, 409);
  assert.equal(fixture.state.payment.status, "FAILED");
  assert.deepEqual(fixture.state.events.map((event) => event.eventType), ["reservation-updated", "payment-updated"]);
});

test("booking writes roll back when appending their outbox event fails", async () => {
  const fixture = bookingFixture({ payment: false });
  fixture.state.reservation = null;
  fixture.tx.outboxEvent.create = async () => { throw new Error("outbox unavailable"); };
  const { reserveSeat } = load("src/controllers/command/reservation.controller.js", fixture.mocks);
  const original = console.error;
  console.error = () => {};
  try {
    const response = await invoke(reserveSeat, { user: { id: "u1" }, body: { show_id: "s1", seat_id: "A1" } });
    assert.equal(response.statusCode, 500);
    assert.equal(fixture.state.reservation, null);
    assert.deepEqual(fixture.state.events, []);
  } finally { console.error = original; }
});

test("real app and route imports serve mocked HTTP requests without infrastructure", async (t) => {
  const fixture = bookingFixture();
  const cache = cacheFixture();
  fixture.command.user = { async findUnique({ where }) {
    return where.id ? { id: where.id, username: "name", email: "a@example.com", is_admin: where.id === "admin" } : null;
  } };
  fixture.command.$queryRaw = async () => [{ value: 1 }];
  const app = load("src/app.js", {
    ...fixture.mocks,
    "utils/cache": cache,
    "config/query-prisma": {
      movie: { async findMany() { return [{ id: "m1", name: "Movie" }]; } },
      show: { async findMany() { return [{ id: "s1", movieName: "Movie" }]; } },
      notification: { async findMany() { return []; } },
      reservation: { async findMany() { return []; } },
      user: { async findMany() { return []; } },
    },
    "config/metrics": {
      httpRequestsTotal: { inc() {} }, httpRequestDuration: { observe() {} },
      register: { contentType: "text/plain", async metrics() { return ""; } },
    },
    jsonwebtoken: { verify(token) { if (!["u1", "admin"].includes(token)) throw new Error("invalid token"); return { id: token }; }, sign() { return "u1"; } },
    bcryptjs: { async hash() { return "hash"; }, async compare() { return true; } },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (pathname, { method = "GET", token, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: pathname, method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => { resolve({ status: res.statusCode, body: JSON.parse(text) }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.deepEqual((await request("/movies")).body, { count: 1, movies: [{ id: "m1", name: "Movie" }] });
  assert.deepEqual((await request("/shows")).body, { count: 1, shows: [{ id: "s1", movieName: "Movie" }] });
  assert.equal((await request("/users")).status, 401);
  assert.equal((await request("/users/u2", { token: "u1" })).status, 403);
  assert.equal((await request("/notification/u2", { token: "u1" })).status, 403);
  assert.equal((await request("/notification/u1", { token: "u1" })).status, 200);
  assert.equal((await request("/seats/reservation/u1", { token: "u1" })).status, 200);
  assert.equal((await request("/seats/reserve", { method: "POST", token: "u1", body: {} })).status, 400);
  assert.equal((await request("/payments/initiate", { method: "POST", token: "u1", body: { reservation_id: "r1", amount: true } })).status, 400);
  assert.equal((await request("/payments/verify", { method: "POST", body: {} })).status, 401);
  assert.equal((await request("/shows", { method: "POST", token: "u1", body: {} })).status, 403);
  assert.equal((await request("/shows", { method: "POST", token: "admin", body: {} })).status, 400);
  assert.equal((await request("/health")).status, 200);
});
