#!/usr/bin/env node
// Secret and customer-material guard for the repository (CI gate, also runnable locally).
// Fails when a tracked or new (not ignored) file is:
//   - customer source material: office/PDF/archive/image files (photos and scans of paper logs are
//     customer material too), anything under a "forras" or "exchange" folder, or a file whose sha256
//     is in scripts/secret-scan-hashes.txt (a renamed copy of a project-folder file, K-35 style);
//   - an environment file other than .env.example;
//   - text containing a credential pattern (private key, provider tokens, a database URL with a real password).
// A line can be exempted only with an explicit "secret-scan: allow" marker on the same line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_EXT =
  /\.(xlsx|xlsm|xls|ods|pdf|zip|7z|rar|docx?|pptx?|numbers|pages|pem|p12|pfx|key|csv|jpe?g|png|heic|heif|tiff?|gif|webp|bmp)$/i;
// narrow exceptions: synthetic CSV fixtures, and the app's own icons and images
const ALLOWED = [/^tests\/fixtures\/.*\.csv$/, /^public\/.*\.(png|svg|ico|webp)$/, /^src\/app\/(icon|apple-icon|favicon)\.(png|ico)$/];
const FORBIDDEN_DIR = /(^|\/)(forras|forras-ascii|exchange)(\/|$)/i;
const ENV_FILE = /(^|\/)\.env(\..+)?$/;
const PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Figma token", /\bfigd_[A-Za-z0-9_-]{20,}/],
  // a database URL with an inline password that is not a placeholder or a variable
  ["database URL with password", /\bpostgres(ql)?:\/\/[^:\s/]+:(?!CHANGE_ME@|\$\{|\$[A-Z_])[^@\s]+@/],
];
const ALLOW_MARK = "secret-scan: allow";

const cwd = process.argv[2] ?? process.cwd();
const HASH_LIST = process.env.SECRET_SCAN_HASHES ?? join(dirname(fileURLToPath(import.meta.url)), "secret-scan-hashes.txt");
const knownHashes = new Set(
  existsSync(HASH_LIST)
    ? readFileSync(HASH_LIST, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[0-9a-f]{64}$/.test(l))
    : [],
);
if (knownHashes.size === 0) {
  console.error(`secret-scan: the hash list ${HASH_LIST} is missing or empty`);
  process.exit(2);
}
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const findings = [];
for (const file of files) {
  if (FORBIDDEN_DIR.test(file)) findings.push(`${file}: customer material folder`);
  if (FORBIDDEN_EXT.test(file) && !ALLOWED.some((re) => re.test(file))) findings.push(`${file}: forbidden file type`);
  if (ENV_FILE.test(file) && !file.endsWith(".env.example")) findings.push(`${file}: environment file`);
  let buf;
  try {
    const st = statSync(`${cwd}/${file}`);
    if (!st.isFile()) continue;
    buf = readFileSync(`${cwd}/${file}`);
  } catch {
    continue; // deleted in the work tree
  }
  if (knownHashes.has(createHash("sha256").update(buf).digest("hex"))) {
    findings.push(`${file}: a copy of a file from the customer project folder`);
  }
  if (buf.length > 2_000_000) continue;
  const text = buf.toString("utf8");
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((line, i) => {
    if (line.includes(ALLOW_MARK)) return;
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push(`${file}:${i + 1}: ${name}`);
  });
}

if (findings.length) {
  console.error(`secret-scan: ${findings.length} finding(s) in ${files.length} files`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`secret-scan: ok (${files.length} files checked)`);
