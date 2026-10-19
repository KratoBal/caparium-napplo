// Resets the TEST database to the migrations plus the synthetic seed before the integration run.
// Refuses to run against a database whose name does not end in "_test": the reset drops the schema.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export const TEST_PASSWORD = "integration-test-password";
export const APP_ROLE_PASSWORD = "integration-app-role-password";

export default async function setup() {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = new URL(url || "postgresql://x/none").pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`integration tests need DATABASE_URL pointing to a *_test database (got "${dbName}")`);
  }
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
  } finally {
    await prisma.$disconnect();
  }
  const env = { ...process.env, SEED_TEST_PASSWORD: TEST_PASSWORD };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", env });
  // the tests run as the application role, like the server (see tests/integration/env.ts)
  const owner = new PrismaClient();
  try {
    await owner.$executeRawUnsafe(`ALTER ROLE caparium_app WITH LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`);
  } finally {
    await owner.$disconnect();
  }
}
