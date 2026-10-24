const commandPrisma = require("../config/command-prisma");

const append = (event, db = commandPrisma) => {
  return db.outboxEvent.create({
    data: {
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: JSON.parse(JSON.stringify(event.payload)),
      status: "PENDING",
    },
  });
};

module.exports = { append };
