
const commandPrisma = require("../config/command-prisma");
const redis = require("../config/redis");

const EVENT_STREAM = "events-stream";
const CONSUMER_GROUP = "event-consumers";
const CONSUMER_NAME = `worker-${process.pid}`;

const subscribers = new Map();

// 1. Save an event inside the business transaction.
// The caller must pass Prisma's transaction client.
async function publish(tx, eventType, aggregateId, payload) {
  return tx.outboxEvent.create({
    data: {
      eventType,
      aggregateId,
      payload,
    },
  });
}

// 2. Create the Redis consumer group if it doesn't exist.
async function setupConsumerGroup() {
  try {
    await redis.xgroup(
      "CREATE",
      EVENT_STREAM,
      CONSUMER_GROUP,
      "0",
      "MKSTREAM"
    );
  } catch (error) {
    if (!error.message.includes("BUSYGROUP")) {
      throw error;
    }
  }
}

// 3. Publish pending outbox events to Redis.

async function publishPendingEvents(prisma) {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  for (const event of events) {
    const message = {
      id: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
      timestamp: event.createdAt.toISOString(),
      payload: event.payload,
    };

    await redis.xadd(
      EVENT_STREAM,
      "*",
      "type",
      message.type,
      "data",
      JSON.stringify(message)
    );

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    console.log("Published event:", message.type, message.id);
  }
}


// 4. Keep checking for pending events.
async function startOutboxPublisher(prisma) {
  console.log("Outbox publisher started");

  while (true) {
    try {
      await publishPendingEvents(prisma);
    } catch (error) {
      console.error("Outbox publisher error:", error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// 5. Register a handler for a particular event type.
function subscribe(eventType, handler) {
  if (!subscribers.has(eventType)) {
    subscribers.set(eventType, []);
  }

  subscribers.get(eventType).push(handler);

  console.log("Subscribed to:", eventType);
}

// 6. Execute handlers registered for the event.
async function notifySubscribers(event) {
  const handlers = subscribers.get(event.type) || [];

  for (const handler of handlers) {
    await handler(event);
  }
}

// 7. Register the Movie projection.
// Pass in your existing Query Prisma client.
function registerSubscribers(queryPrisma) {
  subscribe("MovieCreated", async (event) => {
    const movie = event.payload;

    await queryPrisma.movie.upsert({
      where: { id: movie.id },
      update: {
        name: movie.name,
        genre: movie.genre,
        duration: movie.duration,
      },
      create: {
        id: movie.id,
        name: movie.name,
        genre: movie.genre,
        duration: movie.duration,
        ...(movie.createdAt
          ? { createdAt: new Date(movie.createdAt) }
          : {}),
      },
    });

    console.log("Movie projection updated:", movie.name);
  });
}

// 8. Read events from Redis and process them.
async function consumeEvents() {
  await setupConsumerGroup();

  console.log("Redis event consumer started");

  while (true) {
    try {
      const streams = await redis.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        10,
        "BLOCK",
        5000,
        "STREAMS",
        EVENT_STREAM,
        ">"
      );

      if (!streams) continue;

      for (const [, messages] of streams) {
        for (const [id, fields] of messages) {
          try {
            const dataIndex = fields.indexOf("data");

            if (dataIndex === -1 || !fields[dataIndex + 1]) {
              throw new Error("Event message has no data field");
            }

            const event = JSON.parse(fields[dataIndex + 1]);

            await notifySubscribers(event);

            // Acknowledge only after all matching handlers succeed.
            await redis.xack(
              EVENT_STREAM,
              CONSUMER_GROUP,
              id
            );

            console.log("Processed event:", event.type, id);
          } catch (error) {
            // Failed messages remain pending for recovery.
            console.error("Event processing failed:", error.message);
          }
        }
      }
    } catch (error) {
      console.error("Redis consumer error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

module.exports = {
  publish,
  subscribe,
  notifySubscribers,
  registerSubscribers,
  publishPendingEvents,
  startOutboxPublisher,
  consumeEvents,
};
