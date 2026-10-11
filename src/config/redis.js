
const Redis = require("ioredis");

const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    },
  }
);

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

module.exports = redis;