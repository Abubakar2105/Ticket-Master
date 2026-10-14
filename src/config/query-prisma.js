require("dotenv").config();

const { PrismaClient } = require("../../generated/query/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString = process.env.QUERY_DATABASE_URL;

const adapter = new PrismaPg({
  connectionString,
  max: 100,
  min: 20,
  idleTimeoutMillis: 30 * 1000 * 60,
  maxLifetimeSeconds: 3600
});

const queryPrisma = new PrismaClient({
  adapter
});

module.exports = queryPrisma;