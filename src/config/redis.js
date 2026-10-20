const Redis = require("ioredis");


const startupNodes = (process.env.REDIS_NODES || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean)
  .map((n) => {
    const [host, port] = n.split(":");
    return { host, port: Number(port) };
  });
  const natMap = process.env.REDIS_NAT_MAP
  ? JSON.parse(process.env.REDIS_NAT_MAP)
  : undefined;

const redis = new Redis.Cluster(startupNodes, {
  natMap,
  clusterRetryStrategy(times) {
    return Math.min(times * 100, 2000);
  },
  clusterNodeRetryStrategy(times) {
    return Math.min(times * 100, 2000);
  },
  retryDelayOnFailover: 500,
  maxRedirections: 16,

  redisOptions: {
    maxRetriesPerRequest: 2,
  },
});

redis.on("ready", () => {
  console.log("Redis Cluster ready");
});

redis.on("close", () => {
  console.log("Redis Cluster connection closed");
});

redis.on("reconnecting", (delay) => {
  console.log(`Redis Cluster reconnecting in ${delay}ms`);
});

redis.on("+node", (node) => {
  console.log(
    `Redis Cluster node added: ${node.options.host}:${node.options.port}`
  );
});

redis.on("-node", (node) => {
  console.log(
    `Redis Cluster node removed: ${node.options.host}:${node.options.port}`
  );
});

redis.on("error", (error) => {
  console.error("Redis Cluster error:", error.message);
});

redis.on("node error", (error, address) => {
  console.error(`Redis Cluster node error (${address}):`, error.message);
});

module.exports = redis;