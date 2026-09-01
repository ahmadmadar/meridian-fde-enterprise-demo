import { PrismaClient } from "@prisma/client";

// Singleton pattern — avoids exhausting connections during hot reload / repeated tool calls
export const prisma = new PrismaClient();
