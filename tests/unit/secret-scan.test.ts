// The guard is only a guard if it has been seen to fail: plant each kind of finding in a throwaway repo.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/secret-scan.mjs");
let dir = "";

function repo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

// a planted "customer file": its hash goes into a temporary hash list
const CUSTOMER_FILE = "Medence napló, 2021. március\n";
function hashList(): string {
  const d = mkdtempSync(join(tmpdir(), "secret-scan-hashes-"));
  const sha = createHash("sha256").update(CUSTOMER_FILE).digest("hex");
  writeFileSync(join(d, "hashes.txt"), `# test list\n${sha}\n`);
  return join(d, "hashes.txt");
}
const HASHES = hashList();

function scan(cwd: string) {
  const r = spawnSync("node", [SCRIPT, cwd], { encoding: "utf8", env: { ...process.env, SECRET_SCAN_HASHES: HASHES } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("secret-scan", () => {
  it("passes a clean tree", () => {
    const r = scan(repo({ "src/a.ts": "export const x = 1;\n", ".env.example": "DATABASE_URL=postgresql://u:CHANGE_ME@h/db\n" }));
    expect(r.code).toBe(0);
  });

  it.each([
    ["exchange/caparium/forras/a.txt", "x", "customer material folder"],
    ["docs/Caparium_BMS.xlsx", "x", "forbidden file type"],
    ["docs/leiras.pdf", "x", "forbidden file type"],
    ["export.csv", "Date,Time\n", "forbidden file type"],
    [".env", "X=1\n", "environment file"],
    ["src/k.ts", `const k = "${"ghp_"}${"a".repeat(36)}";\n`, "GitHub token"],
    ["src/p.ts", `-----BEGIN ${"RSA "}PRIVATE KEY-----\n`, "private key"],
    ["docker.yml", "url: postgresql://caparium:titkos123@db:5432/x\n", "database URL with password"], // secret-scan: allow
    ["docs/fotok/naplo-2021.jpg", "x", "forbidden file type"],
    ["scan/oldal.HEIC", "x", "forbidden file type"],
    ["public/../kepek/meres.png", "x", "forbidden file type"],
    ["notes/atnevezett.txt", CUSTOMER_FILE, "a copy of a file from the customer project folder"],
  ])("fails on %s", (name, content, finding) => {
    const r = scan(repo({ [name]: content }));
    expect(r.code).toBe(1);
    expect(r.out).toContain(finding);
  });

  it("lets the app's own icons through, only under public/", () => {
    expect(scan(repo({ "public/icon-192.png": "x", "src/app/icon.png": "x" })).code).toBe(0);
  });

  it("refuses to run without a hash list (a guard that cannot fire is not a guard)", () => {
    const r = spawnSync("node", [SCRIPT, repo({ "a.ts": "x" })], { encoding: "utf8", env: { ...process.env, SECRET_SCAN_HASHES: "/nonexistent" } });
    expect(r.status).toBe(2);
  });

  it("honours an explicit allow marker on the same line only", () => {
    const r = scan(repo({ "ci.yml": "url: postgresql://caparium:ci-only@localhost/x # secret-scan: allow\n" }));
    expect(r.code).toBe(0);
  });
});
