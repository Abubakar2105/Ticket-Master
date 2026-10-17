
const redis = require("../config/redis");
const consumerRedis = redis.duplicate();

const { notifySubscribers } = require("./publish");

const STREAM_NAME = "events-stream";
const GROUP_NAME = "event-consumers";
const CONSUMER_NAME = "consumer-1";
const BATCH_SIZE = 10;
const BLOCK_TIME = 5000;

async function ensureConsumerGroup() {
  try {
    await consumerRedis.xgroup(
      "CREATE",
      STREAM_NAME,
      GROUP_NAME,
      "0",
      "MKSTREAM"
    );

    console.log("Consumer group created");
  } catch (error) {
    if (error.message.includes("BUSYGROUP")) {
      console.log("Consumer group already exists");
      return;
    }

    throw error;
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

async function consumeEvents(consumerName = CONSUMER_NAME) {
  await consumerRedis.ping();
  await ensureConsumerGroup()
  console.log(`Consumer started: ${consumerName}`);

  while (true) {
    try {
      const result = await consumerRedis.xreadgroup(
        "GROUP",
        GROUP_NAME,
        consumerName,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        BLOCK_TIME,
        "STREAMS",
        STREAM_NAME,
        ">"
      );

      if (!result) {
        continue;
      }

      for (const [, messages] of result) {
        for (const [streamId, fields] of messages) {
          try {
            const event = parseRedisMessage(fields);

            console.log("Event received:", {
              streamId,
              eventType: event.eventType,
              aggregateId: event.aggregateId,
            });

            // Run the registered subscriber/projection.
            await notifySubscribers(event);

            // Acknowledge only after processing succeeds.
            await consumerRedis.xack(
              STREAM_NAME,
              GROUP_NAME,
              streamId
            );

            console.log(`Event processed and acknowledged: ${streamId}`);
          } catch (error) {
            console.error(
              `Failed to process event ${streamId}:`,
              error.message
            );
          }
        }
      }
    } catch (error) {
      console.error("Consumer error:", error.message);

      // Avoid a tight retry loop if Redis or the stream is unavailable.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

consumerRedis.on("error", (error) => {
  console.error("Consumer Redis connection error:", error.message);
});



module.exports = { consumeEvents };
