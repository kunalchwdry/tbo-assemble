import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

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
    {
      id: "rb-2",
      roomType: "Royal Premiere",
      description: "City view, executive lounge access",
      rate: 24000,
      totalQty: 25,
      bookedQty: 18,
      floor: "4",
      wing: "Main Wing",
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
    {
      id: "g-2",
      name: "Vikram Malhotra",
      email: "vikram@example.com",
      phone: "+91 98765 43211",
      group: "Keynote Speaker",
      status: "confirmed",
      proximityRequest: null,
      notes: null,
      allocatedFloor: "4",
      allocatedWing: "Main",
      allocatedRoom: "405",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "g-3",
      name: "Pooja Reddy",
      email: "pooja@example.com",
      phone: "+91 98765 43212",
      group: "Operations",
      status: "invited",
      proximityRequest: null,
      notes: null,
      allocatedFloor: null,
      allocatedWing: null,
      allocatedRoom: null,
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
    {
      id: "b-2",
      guestId: "g-2",
      eventId: "2e4e7cb5-955e-4dc5-9dc4-5ce255f541e5",
      roomBlockId: "rb-2",
      totalAmount: 96000,
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

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let prismaInstance: PrismaClient;

if (connectionString) {
  const adapter = new PrismaPg({ connectionString });
  prismaInstance = globalForPrisma.prisma ?? new PrismaClient({ adapter });
} else {
  console.warn(
    "[Prisma] DATABASE_URL is not configured. Running in local demo fallback mode with sample event data."
  );
  prismaInstance = globalForPrisma.prisma ?? createFallbackPrisma();
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prismaInstance;
}

export default prismaInstance;
