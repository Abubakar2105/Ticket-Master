require("dotenv").config();

const { startOutboxWorker } = require("./workers/outbox.worker");
const { consumeEvents } = require("./events/consumer");
const { setupEventSubscribers } = require("./events/register");

async function main() {
  setupEventSubscribers();

  console.log("Background worker started");

  await Promise.all([
    startOutboxWorker(),
    consumeEvents("consumer-1"),
  ]);
}

main().catch((error) => {
  console.error("Background worker failed:", error);
  process.exit(1);
});