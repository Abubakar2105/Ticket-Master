const commandPrisma = require("../config/command-prisma");
const { publish } = require("../events/publish");

const BATCH_SIZE = 10;
const POLL_INTERVAL = 5000; // 5 second

const processOutbox = async () => {
  const events = await commandPrisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const event of events) {
    try {
      await publish(event);
      await commandPrisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      console.log(`Published event: ${event.id}`);
    } catch (error) {
      console.error(
        `Failed to publish event ${event.id}:`,
        error.message
      );
    }
  }
};

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const startOutboxWorker = async () => {
  console.log("Outbox worker started");

  while (true) {
    try {
      await processOutbox();
    } catch (error) {
      console.error("Outbox polling error:", error.message);
    }
    await sleep(POLL_INTERVAL);
  }
};

module.exports = {
  startOutboxWorker,
  processOutbox,
};