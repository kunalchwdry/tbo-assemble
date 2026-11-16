import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let instance: PrismaClient | undefined;

/**
 * Creates the client on first use rather than when this module loads. `next build` imports every route
 * to read its configuration, so a top-level check made builds (and Vercel preview deployments without
 * the secret) fail even for pages that never touch the database, such as the inventory demo.
 * Database-backed routes still fail clearly, at request time, when DATABASE_URL is missing.
 */
function client(): PrismaClient {
  if (instance) return instance;
  if (globalForPrisma.prisma) return (instance = globalForPrisma.prisma);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be configured for the PostgreSQL database.");
  }
  instance = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = instance;
  return instance;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    // Not a thenable, and inspection (symbols) never forces a connection.
    if (property === "then" || typeof property === "symbol") return instance ? Reflect.get(instance, property) : undefined;
    const real = client();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export default prisma;
