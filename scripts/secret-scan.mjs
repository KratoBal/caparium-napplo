#!/usr/bin/env node
// Secret and customer-material guard for the repository (CI gate, also runnable locally).
// Fails when a tracked or new (not ignored) file is:
//   - customer source material: office/PDF/archive files, or anything under a "forras" or "exchange" folder
//     (the customer's documents stay in the project folder, never in the repo);
//   - an environment file other than .env.example;
//   - text containing a credential pattern (private key, provider tokens, a database URL with a real password).
// A line can be exempted only with an explicit "secret-scan: allow" marker on the same line.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const FORBIDDEN_EXT = /\.(xlsx|xlsm|xls|ods|pdf|zip|7z|rar|docx?|pptx?|numbers|pages|pem|p12|pfx|key|csv)$/i;
const ALLOWED_CSV = /^tests\/fixtures\/.*\.csv$/; // synthetic fixtures only
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
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const findings = [];
for (const file of files) {
  if (FORBIDDEN_DIR.test(file)) findings.push(`${file}: customer material folder`);
  if (FORBIDDEN_EXT.test(file) && !ALLOWED_CSV.test(file)) findings.push(`${file}: forbidden file type`);
  if (ENV_FILE.test(file) && !file.endsWith(".env.example")) findings.push(`${file}: environment file`);
  let text;
  try {
    const st = statSync(`${cwd}/${file}`);
    if (!st.isFile() || st.size > 2_000_000) continue;
    text = readFileSync(`${cwd}/${file}`, "utf8");
  } catch {
    continue; // deleted in the work tree
  }
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
