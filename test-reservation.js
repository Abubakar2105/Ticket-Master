
const prisma = require("./src/config/prisma");

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const TOKEN_A = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNtdjNxcXBidTAwMDB2MG45aXdqZTh0b2MiLCJpYXQiOjE3OTE3MTgxODcsImV4cCI6MTc5MTgwNDU4N30.brZGTZ6-wJOtHpm3KBLMLWdAZs83kBguz7WMqoSaRDE";
const TOKEN_B = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNtdjNxbnF4cTAwMDB0d245dmU0NTNiZDciLCJpYXQiOjE3OTE3NTA2ODAsImV4cCI6MTc5MTgzNzA4MH0.3BZNWFKOYho5aCjhn9kvaXy4IQIDCPTVERf_Pgt9pvg";
const SHOW_ID = "cmv3qwmj20000jwn9eij2tnbz";
const USER_A_ID = "cmv3qqpbu0000v0n9iwje8toc";

let passed = 0;
let failed = 0;

const uniqueSeat = () => `T${Date.now().toString().slice(-8)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data };
}

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}

async function reserve(token, seat) {
  return request("/seats/reserve", {
    method: "POST",
    token,
    body: {
      show_id: SHOW_ID,
      seat_id: seat,
    },
  });
}

async function cancel(token, reservationId) {
  return request("/seats/reservation/cancel", {
    method: "POST",
    token,
    body: { reservation_id: reservationId },
  });
}

async function initiatePayment(token, reservationId) {
  return request("/payments/initiate", {
    method: "POST",
    token,
    body: {
      reservation_id: reservationId,
      amount: 100,
    },
  });
}

async function verifyPayment(token, paymentId, result) {
  return request("/payments/verify", {
    method: "POST",
    token,
    body: {
      payment_id: paymentId,
      payment_result: result,
    },
  });
}

async function main() {
  if (!TOKEN_A || !TOKEN_B || !SHOW_ID || !USER_A_ID) {
    console.error(
      "Set USER_A_TOKEN, USER_B_TOKEN, SHOW_ID, and USER_A_ID first."
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Testing API: ${BASE_URL}`);
  console.log("Use a development database and a future show.\n");

  // 1. Authentication
  await test("Reject unauthenticated reservation", async () => {
    const result = await request("/seats/reserve", {
      method: "POST",
      body: { show_id: SHOW_ID, seat_id: uniqueSeat() },
    });

    assert(result.status === 401, `Expected 401, got ${result.status}`);
  });

  // 2. Invalid input
  await test("Reject invalid reservation input", async () => {
    const result = await request("/seats/reserve", {
      method: "POST",
      token: TOKEN_A,
      body: { show_id: "", seat_id: "" },
    });

    assert(result.status === 400, `Expected 400, got ${result.status}`);
  });

  // 3. Successful reservation
  let cancelReservationId;
  let cancelSeat;

  await test("Create a reservation", async () => {
    cancelSeat = uniqueSeat();
    const result = await reserve(TOKEN_A, cancelSeat);

    assert(result.status === 201, `Expected 201, got ${result.status}`);
    assert(
      result.data.reservation?.status === "HELD",
      "Reservation should be HELD"
    );

    cancelReservationId = result.data.reservation.id;
  });

  // 4. Seat availability
  await test("Held seat is unavailable", async () => {
    const result = await request(
      `/seats/${cancelSeat}?show_id=${encodeURIComponent(SHOW_ID)}`,
      { token: TOKEN_A }
    );

    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(result.data.available === false, "Seat should be unavailable");
  });

  // 5. Cancellation ownership
  await test("Another user cannot cancel the reservation", async () => {
    const result = await cancel(TOKEN_B, cancelReservationId);

    assert(result.status === 403, `Expected 403, got ${result.status}`);
  });

  // 6. Cancellation
  await test("Owner can cancel their held reservation", async () => {
    const result = await cancel(TOKEN_A, cancelReservationId);

    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(
      result.data.reservation?.status === "CANCELLED",
      "Reservation should be CANCELLED"
    );
  });

  await test("Cancelled seat becomes available", async () => {
    const result = await request(
      `/seats/${cancelSeat}?show_id=${encodeURIComponent(SHOW_ID)}`,
      { token: TOKEN_A }
    );

    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(result.data.available === true, "Seat should be available");
  });

  // 7. Concurrent attempts to reserve the same seat
  let concurrentReservationId;

  await test("Only one concurrent request reserves a seat", async () => {
    const seat = uniqueSeat();

    const results = await Promise.all([
      reserve(TOKEN_A, seat),
      reserve(TOKEN_B, seat),
    ]);

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    assert(successes.length === 1, `Expected 1 success, got ${successes.length}`);
    assert(conflicts.length === 1, `Expected 1 conflict, got ${conflicts.length}`);

    concurrentReservationId = successes[0].data.reservation.id;
  });

  // 8. Payment success
  let successfulReservationId;
  let successfulPaymentId;

  await test("Initiate payment for a held reservation", async () => {
    const result = await reserve(TOKEN_A, uniqueSeat());

    assert(result.status === 201, `Reservation failed: ${result.status}`);
    successfulReservationId = result.data.reservation.id;

    const payment = await initiatePayment(TOKEN_A, successfulReservationId);

    assert(payment.status === 201, `Expected 201, got ${payment.status}`);
    assert(payment.data.payment?.status === "PENDING", "Payment should be PENDING");

    successfulPaymentId = payment.data.payment.id;
  });

  await test("Another user cannot verify payment", async () => {
    const result = await verifyPayment(
      TOKEN_B,
      successfulPaymentId,
      "SUCCESS"
    );

    assert(result.status === 403, `Expected 403, got ${result.status}`);
  });

  await test("Successful simulated payment confirms reservation", async () => {
    const result = await verifyPayment(
      TOKEN_A,
      successfulPaymentId,
      "SUCCESS"
    );

    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(
      result.data.payment?.status === "SUCCESS",
      "Payment should be SUCCESS"
    );
    assert(
      result.data.reservation_status === "CONFIRMED",
      "Reservation should be CONFIRMED"
    );
  });

  await test("Payment cannot be processed twice", async () => {
    const result = await verifyPayment(
      TOKEN_A,
      successfulPaymentId,
      "SUCCESS"
    );

    assert(result.status === 409, `Expected 409, got ${result.status}`);
  });

  // 9. Payment failure
  let failedPaymentId;
  let failedReservationId;

  await test("Failed simulated payment is recorded", async () => {
    const reservation = await reserve(TOKEN_A, uniqueSeat());

    assert(reservation.status === 201, "Could not create test reservation");
    failedReservationId = reservation.data.reservation.id;

    const payment = await initiatePayment(TOKEN_A, failedReservationId);

    assert(payment.status === 201, "Could not initiate test payment");
    failedPaymentId = payment.data.payment.id;

    const result = await verifyPayment(
      TOKEN_A,
      failedPaymentId,
      "FAILED"
    );

    assert(result.status === 200, `Expected 200, got ${result.status}`);
    assert(result.data.payment?.status === "FAILED", "Payment should be FAILED");

    // Clean up the remaining hold.
    const cancellation = await cancel(TOKEN_A, failedReservationId);
    assert(cancellation.status === 200, "Could not cancel remaining hold");
  });

  // 10. Expired hold is released on a new booking attempt
  let expiredReservationId;

  await test("Expired hold is marked EXPIRED and seat can be rebooked", async () => {
    const seat = uniqueSeat();
    const original = await reserve(TOKEN_A, seat);

    assert(original.status === 201, "Could not create test hold");
    expiredReservationId = original.data.reservation.id;

    // Force expiry in the development database instead of
    // waiting for the normal two-minute hold.
    await prisma.reservation.update({
      where: { id: expiredReservationId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const replacement = await reserve(TOKEN_B, seat);

    assert(
      replacement.status === 201,
      `Expected new booking 201, got ${replacement.status}`
    );

    const oldReservation = await prisma.reservation.findUnique({
      where: { id: expiredReservationId },
    });

    assert(
      oldReservation.status === "EXPIRED",
      `Expected EXPIRED, got ${oldReservation.status}`
    );

    // Leave the replacement hold for the cancellation test below.
    const cleanup = await cancel(TOKEN_B, replacement.data.reservation.id);
    assert(cleanup.status === 200, "Could not clean up replacement hold");
  });

  // 11. Duplicate payment initiation
  await test("Duplicate payment initiation is rejected", async () => {
    const reservation = await reserve(TOKEN_A, uniqueSeat());

    assert(reservation.status === 201, "Could not create test reservation");
    const reservationId = reservation.data.reservation.id;

    const first = await initiatePayment(TOKEN_A, reservationId);
    assert(first.status === 201, `Expected 201, got ${first.status}`);

    const second = await initiatePayment(TOKEN_A, reservationId);
    assert(second.status === 409, `Expected 409, got ${second.status}`);

    const cleanup = await cancel(TOKEN_A, reservationId);
    assert(cleanup.status === 200, "Could not cancel test reservation");
  });

  // 12. User reservation ownership
  await test("User cannot view another user's reservations", async () => {
    const result = await request(
      `/seats/reservation/${encodeURIComponent(USER_A_ID)}`,
      { token: TOKEN_B }
    );

    assert(result.status === 403, `Expected 403, got ${result.status}`);
  });

  // Cleanup any hold left by the concurrency test.
  if (concurrentReservationId) {
    await cancel(TOKEN_A, concurrentReservationId).catch(() => {});
    await cancel(TOKEN_B, concurrentReservationId).catch(() => {});
  }

  console.log("\n==============================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("==============================");

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Test runner error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });