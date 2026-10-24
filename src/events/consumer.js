const { randomUUID } = require("crypto");
const { hostname } = require("os");
const redis = require("../config/redis");
const consumerRedis = redis.duplicate();
const { notifySubscribers } = require("./publish");

const STREAM_NAME = "events-stream";
const GROUP_NAME = "event-consumers";
const CONSUMER_NAME = `${hostname()}:${process.pid}:${randomUUID()}`;
const BATCH_SIZE = 10;
const BLOCK_TIME = 5000;
const RETRY_IDLE_TIME = 60000;

async function ensureConsumerGroup() {
  try {
    await consumerRedis.xgroup("CREATE", STREAM_NAME, GROUP_NAME, "0", "MKSTREAM");
  } catch (error) {
    if (!error.message.includes("BUSYGROUP")) {
      throw error;
    }
  }
}

function parseRedisMessage(fields) {
  const data = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }
  return {
    id: data.eventId,
    eventType: data.eventType,
    aggregateId: data.aggregateId,
    payload: JSON.parse(data.payload),
  };
}

async function processMessages(messages) {
  for (const [streamId, fields] of messages) {
    try {
      await notifySubscribers(parseRedisMessage(fields));
      await consumerRedis.xack(STREAM_NAME, GROUP_NAME, streamId);
    } catch (error) {
      console.error(`Failed to process event ${streamId}:`, error.message);
    }
  }
}

async function consumeEvents(consumerName = CONSUMER_NAME) {
  await consumerRedis.ping();
  await ensureConsumerGroup();
  console.log(`Consumer started: ${consumerName}`);
  let retryCursor = "0-0";

  while (true) {
    try {
      // Failed projections remain pending and must be retried, not just new messages consumed.
      const [nextCursor, pending] = await consumerRedis.xautoclaim(
        STREAM_NAME, GROUP_NAME, consumerName, RETRY_IDLE_TIME, retryCursor, "COUNT", BATCH_SIZE
      );
      retryCursor = nextCursor;
      await processMessages(pending);

      const result = await consumerRedis.xreadgroup(
        "GROUP", GROUP_NAME, consumerName, "COUNT", BATCH_SIZE,
        "BLOCK", BLOCK_TIME, "STREAMS", STREAM_NAME, ">"
      );
      for (const [, messages] of result || []) {
        await processMessages(messages);
      }
    } catch (error) {
      console.error("Consumer error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

consumerRedis.on("error", (error) => {
  console.error("Consumer Redis connection error:", error.message);
});

module.exports = { consumeEvents };
