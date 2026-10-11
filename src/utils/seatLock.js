const crypto = require("crypto");
const redis = require("../config/redis");

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end

  return 0
`;

async function withSeatLock(show_id,seatNumber, callback) {
    const key = `lock:seat:${show_id}:${seatNumber}`;
    const token = crypto.randomUUID();
    let acquired;
    try {
        acquired = await redis.set(
            key,
            token,
            "PX",
            15_000,
            "NX"
        );

    } catch (error) {
        const unavailable = new Error(
            "Reservation service is unavailable"
        )
        unavailable.statusCode = 503;
    throw unavailable;
}
    if (acquired !== "OK") {
    const error = new Error(
    "This seat is being processed. Please try again."
    );

    error.statusCode = 409;
    throw error;
    }
     try {
    return await callback();
  } finally {
    // 7. Release the lock only if we still own it.
    try {
      await redis.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        key,
        token
      );
    } catch (error) {
      console.error(
        "Failed to release Redis seat lock:",
        error.message
      );
    }
  }
}

module.exports = {withSeatLock}