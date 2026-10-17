const Redis = require("ioredis");

const startupNodes = (process.env.REDIS_NODES || "127.0.0.1:7001,127.0.0.1:7002,127.0.0.1:7003")
  .split(",")
  .map((n) => {
    const [host, port] = n.trim().split(":");
    return { host, port: Number(port) };
  });

const natMap = process.env.REDIS_NAT === "false" ? undefined : {
  "172.30.0.11:7001": { host: "127.0.0.1", port: 7001 },
  "172.30.0.12:7002": { host: "127.0.0.1", port: 7002 },
  "172.30.0.13:7003": { host: "127.0.0.1", port: 7003 },
  "172.30.0.14:7004": { host: "127.0.0.1", port: 7004 },
  "172.30.0.15:7005": { host: "127.0.0.1", port: 7005 },
  "172.30.0.16:7006": { host: "127.0.0.1", port: 7006 },
};

const redis = new Redis.Cluster(startupNodes, {
  natMap,
  redisOptions: {
    maxRetriesPerRequest: 2,
  },
  clusterRetryStrategy(times) {
    return Math.min(times * 100, 2000);
  },
});

redis.on("ready", () => console.log("Redis cluster ready"));
redis.on("close", () => console.log("Redis cluster connection closed"));
redis.on("reconnecting", (delay) => console.log(`Redis reconnecting in ${delay}ms`));
redis.on("+node", (node) => console.log(`Node added: ${node.options.host}:${node.options.port}`));
redis.on("-node", (node) => console.log(`Node removed: ${node.options.host}:${node.options.port}`));
redis.on("error", (error) => console.error("Redis error:", error.message));
redis.on("node error", (error, address) => console.error(`Redis node error (${address}):`, error.message));

module.exports = redis;