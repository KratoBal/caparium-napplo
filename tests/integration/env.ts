// Runs in every test worker before the test files are imported: the code under test connects
// as caparium_app (the server's role, review of PR #1 point C), the owner URL stays available
// for fixture changes and for the tests that check what the owner can and cannot do.
import { APP_ROLE_PASSWORD } from "./global-setup";

if (!process.env.OWNER_DATABASE_URL) {
  const owner = process.env.DATABASE_URL ?? "";
  const app = new URL(owner);
  app.username = "caparium_app";
  app.password = APP_ROLE_PASSWORD;
  process.env.OWNER_DATABASE_URL = owner;
  process.env.DATABASE_URL = app.toString();
}
