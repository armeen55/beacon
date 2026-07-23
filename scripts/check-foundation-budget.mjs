#!/usr/bin/env node
// Foundation guard — the bloat firewall. Fails CI when the repo grows past its
// mechanically-enforced budgets, so Beacon can never regrow to 500k lines.
// No dependencies beyond Node built-ins. Config: foundation-budget.json.
//
// Checks:
//   1. production TypeScript LOC <= production.max
//   2. test TypeScript LOC <= tests.max
//   3. combined LOC <= combined.hardCap
//   4. customer page routes are a subset of routes.pagesAllow (no new customer route)
//   5. api routes are a subset of routes.apiAllow
//   6. top-level src/domains count <= domains.max (no new top-level domain)
//   7. no NEW production file > files.newFileMax lines; grandfathered oversized
//      files must not exceed their recorded ceiling in files.grandfathered
//   8. src/app imports only allowed boundaries (kernel facades + lib + components +
//      framework), never a private kernel internal path in imports.appForbiddenDomainDeep
//   9. package.json dependencies are a subset of deps.allow (no new dependency)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const ROOT = resolve(process.cwd());
const cfg = JSON.parse(readFileSync(join(ROOT, "foundation-budget.json"), "utf8"));
const failures = [];
const fail = (m) => failures.push(m);

function walk(dir, exts = /\.(ts|tsx)$/) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name === ".codex") continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const isTest = (f) => /\.test\.(ts|tsx)$/.test(f) || `${sep}tests${sep}` === f.slice(ROOT.length).replace(/[^/\\]+$/, "").slice(0, 7) || relative(ROOT, f).startsWith("tests" + sep);
const loc = (f) => readFileSync(f, "utf8").split("\n").length;

const srcFiles = walk(join(ROOT, "src"));
const testTreeFiles = walk(join(ROOT, "tests"));
const prodFiles = srcFiles.filter((f) => !/\.test\.(ts|tsx)$/.test(f));
const testFiles = [...srcFiles.filter((f) => /\.test\.(ts|tsx)$/.test(f)), ...testTreeFiles];

const sum = (files) => files.reduce((a, f) => a + loc(f), 0);
const prodLoc = sum(prodFiles);
const testLoc = sum(testFiles);
const combined = prodLoc + testLoc;

// 1-3. LOC budgets
if (prodLoc > cfg.production.max) fail(`production LOC ${prodLoc} > budget ${cfg.production.max}`);
if (testLoc > cfg.tests.max) fail(`test LOC ${testLoc} > budget ${cfg.tests.max}`);
if (combined > cfg.combined.hardCap) fail(`combined LOC ${combined} > hard cap ${cfg.combined.hardCap}`);

// 4-5. route allowlists
const rel = (f) => relative(ROOT, f).split(sep).join("/");
const pageRoutes = prodFiles
  .map(rel)
  .filter((f) => /^src\/app\/.*\/page\.tsx$/.test(f) || f === "src/app/page.tsx")
  .map((f) => f.replace(/^src\/app\//, "").replace(/\/?page\.tsx$/, "") || "/");
const apiRoutes = prodFiles.map(rel).filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f))
  .map((f) => f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, ""));
for (const r of pageRoutes) if (!cfg.routes.pagesAllow.includes(r)) fail(`unauthorized customer route: ${r} (add to routes.pagesAllow only with operator approval)`);
for (const r of apiRoutes) if (!cfg.routes.apiAllow.includes(r)) fail(`unauthorized api route: ${r}`);

// 6. domain ceiling
const domains = new Set(prodFiles.map(rel).filter((f) => f.startsWith("src/domains/")).map((f) => f.split("/")[2]));
if (domains.size > cfg.domains.max) fail(`top-level src/domains count ${domains.size} > budget ${cfg.domains.max}: ${[...domains].sort().join(", ")}`);

// 7. giant-file rule
for (const f of prodFiles) {
  const r = rel(f);
  const n = loc(f);
  const ceiling = cfg.files.grandfathered[r];
  if (ceiling !== undefined) {
    if (n > ceiling) fail(`grandfathered file grew: ${r} is ${n} > ceiling ${ceiling} (shrink it, do not grow it)`);
  } else if (n > cfg.files.newFileMax) {
    fail(`new/unlisted file over ${cfg.files.newFileMax} lines: ${r} (${n}) — split it or get it allowlisted`);
  }
  if (n > cfg.files.hardMax && ceiling === undefined) fail(`file exceeds hard max ${cfg.files.hardMax}: ${r} (${n})`);
}

// 8. app boundary — src/app must not deep-import a forbidden private kernel internal
if (cfg.imports && Array.isArray(cfg.imports.appForbiddenDomainDeep)) {
  const appFiles = prodFiles.filter((f) => rel(f).startsWith("src/app/"));
  const importRe = /from\s+["']([^"']+)["']/g;
  for (const f of appFiles) {
    const src = readFileSync(f, "utf8");
    let m;
    while ((m = importRe.exec(src))) {
      const spec = m[1];
      for (const forbidden of cfg.imports.appForbiddenDomainDeep) {
        if (spec.includes(forbidden)) fail(`src/app import of forbidden kernel internal: ${rel(f)} -> ${spec} (import the kernel facade, not internals)`);
      }
    }
  }
}

// 9. dependency allowlist
if (cfg.deps && Array.isArray(cfg.deps.allow)) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = Object.keys(pkg.dependencies || {});
  for (const d of declared) if (!cfg.deps.allow.includes(d)) fail(`unauthorized dependency: ${d} (add to deps.allow only with operator approval)`);
}

// report
const line = (k, v, max) => `  ${k}: ${v}${max !== undefined ? ` / ${max}` : ""}`;
console.log("Foundation budget check");
console.log(line("production LOC", prodLoc, cfg.production.max));
console.log(line("test LOC", testLoc, cfg.tests.max));
console.log(line("combined LOC", combined, cfg.combined.hardCap));
console.log(line("customer routes", pageRoutes.length));
console.log(line("api routes", apiRoutes.length));
console.log(line("top-level domains", domains.size, cfg.domains.max));

if (failures.length) {
  console.error(`\nFOUNDATION GUARD FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✓ Foundation guard passed — within every budget.");
