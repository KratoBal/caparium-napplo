// Container start, as the table owner: give the application role its login password.
// The password is the one in the app's DATABASE_URL, so the two can never disagree.
// Bundled to dist/db-role.cjs; called by scripts/start.sh only in two-role mode.
import { PrismaClient } from "@prisma/client";

const APP_ROLE = "caparium_app";

async function main() {
  const owner = process.env.MIGRATE_DATABASE_URL;
  const app = process.env.DATABASE_URL;
  if (!owner || !app) throw new Error("MIGRATE_DATABASE_URL and DATABASE_URL are both required");
  const url = new URL(app);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== APP_ROLE) throw new Error(`DATABASE_URL must use the ${APP_ROLE} role in two-role mode (got "${user}")`);
  if (password.length < 16) throw new Error("the app role password must be at least 16 characters");
  const prisma = new PrismaClient({ datasources: { db: { url: owner } } });
  try {
    // ALTER ROLE takes no bind parameters: the literal is quoted by doubling single quotes
    // (standard_conforming_strings is on in every supported PostgreSQL)
    const literal = `'${password.replace(/'/g, "''")}'`;
    await prisma.$executeRawUnsafe(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${literal}`);
    console.log(`db-role: ${APP_ROLE} can log in`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
