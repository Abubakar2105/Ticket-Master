require("dotenv").config();

const { PrismaClient } = require("../../generated/command/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString = process.env.COMMAND_DATABASE_URL;

const adapter = new PrismaPg({
  connectionString,
  max: 100,
  min: 20,
  idleTimeoutMillis: 30 * 1000 * 60,
  maxLifetimeSeconds: 3600
});

const commandPrisma = new PrismaClient({
  adapter
});

module.exports = commandPrisma;