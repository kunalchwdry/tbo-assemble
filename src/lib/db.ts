import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let instance: PrismaClient | undefined;

const defaultMockEvent = {
  id: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
  name: "Annual Leadership Summit 2026",
  slug: "leadership-summit-2026",
  type: "Corporate Summit",
  venue: "The Leela Palace",
  location: "Bengaluru, Karnataka",
  checkIn: new Date("2026-11-20T10:00:00.000Z"),
  checkOut: new Date("2026-11-24T12:00:00.000Z"),
  description: "Annual executive leadership conference and offsite retreat.",
  primaryColor: "#1e40af",
  secondaryColor: "#f0f9ff",
  accentColor: "#3b82f6",
  heroImageUrl: null,
  expectedPax: 150,
  agentId: "agent-1",
  status: "active",
  createdAt: new Date("2026-11-01"),
  updatedAt: new Date("2026-11-15"),
  roomBlocks: [
    {
      id: "rb-1",
      roomType: "Deluxe Suite",
      description: "King bed, palace garden view",
      rate: 18500,
      totalQty: 40,
      bookedQty: 32,
      floor: "3",
      wing: "East Wing",
      hotelName: "The Leela Palace",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  guests: [
    {
      id: "g-1",
      name: "Ananya Sharma",
      email: "ananya@example.com",
      phone: "+91 98765 43210",
      group: "Executive",
      status: "confirmed",
      proximityRequest: null,
      notes: null,
      allocatedFloor: "3",
      allocatedWing: "East",
      allocatedRoom: "302",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  bookings: [
    {
      id: "b-1",
      guestId: "g-1",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      roomBlockId: "rb-1",
      totalAmount: 74000,
      status: "confirmed",
      checkedIn: false,
      checkedInAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  addOns: [],
  attritionRules: [
    {
      id: "ar-1",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      releaseDate: new Date("2026-11-18"),
      releasePercent: 20,
      description: "Initial release 48h prior",
      isTriggered: false,
      createdAt: new Date(),
    },
  ],
  discountRules: [],
};

function createFallbackPrisma(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "event") {
          return {
            findUnique: async () => defaultMockEvent,
            findMany: async () => [defaultMockEvent],
            findFirst: async () => defaultMockEvent,
            count: async () => 1,
          };
        }
        return new Proxy(
          {},
          {
            get(_subTarget, subProp) {
              if (subProp === "findMany") return async () => [];
              if (subProp === "findUnique") return async () => null;
              if (subProp === "findFirst") return async () => null;
              if (subProp === "count") return async () => 0;
              return async () => ({});
            },
          }
        );
      },
    }
  ) as PrismaClient;
}

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
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Prisma] DATABASE_URL is not configured. Running in local demo fallback mode."
      );
      return (instance = createFallbackPrisma());
    }
    throw new Error("DATABASE_URL must be configured for the PostgreSQL database.");
  }
  instance = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = instance;
  return instance;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    // Not a thenable, and inspection (symbols) never forces a connection.
    if (property === "then" || typeof property === "symbol")
      return instance ? Reflect.get(instance, property) : undefined;
    const real = client();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export default prisma;
