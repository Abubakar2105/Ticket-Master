require("dotenv").config();
const { PrismaClient} = require("../../generated/prisma/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString = `${process.env.DATABASE_URL}`;


const adapter = new PrismaPg({ 
    connectionString, 
    max:100,
    min:20,
    idleTimeoutMillis:30*1000*60,
    maxLifetimeSeconds:3600 });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
