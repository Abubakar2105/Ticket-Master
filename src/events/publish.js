const redis = require("../config/redis");

const EVENT_STREAM = "events-stream";

const subscribers = new Map();

const publish = async (event) => {
  const streamId = await redis.xadd(
    EVENT_STREAM,
    "*",
    "eventId",
    event.id,
    "eventType",
    event.eventType,
    "aggregateId",
    event.aggregateId,
    "payload",
    JSON.stringify(event.payload)
  );

  console.log(`Event published: ${event.eventType} | Redis ID: ${streamId}`);

  return streamId;
};

const subscribe = (eventName, handler) => {
  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, []);
  }

  subscribers.get(eventName).push(handler);

  console.log(`Subscriber registered: ${eventName}`);
};

const notifySubscribers = async (event) => {
  const handlers = subscribers.get(event.eventType) || [];

  console.log(
    `Looking for subscribers: ${event.eventType}`
  );

  console.log(
    `Matching handlers: ${handlers.length}`
  );

  for (const handler of handlers) {
    await handler(event);
  }
};

module.exports = {
  publish,
  subscribe,
  notifySubscribers,
};