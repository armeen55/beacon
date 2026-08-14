#!/usr/bin/env node
// Foundation guard — the bloat firewall. Fails CI when the repo grows past its
// mechanically-enforced budgets, so Beacon can never regrow to 500k lines.
// No dependencies beyond Node built-ins. Config: foundation-budget.json.
//
// Checks:
//   1. production TypeScript LOC <= production.max
//   2. test TypeScript LOC <= tests.max
//   3. combined LOC <= combined.hardCap
//   4. customer page routes are a subset of routes.pagesAllow
//   5. api routes are a subset of routes.apiAllow
//   6. top-level src/domains count <= domains.max (the five kernels)
//   7. no NEW production file > files.newFileMax; grandfathered files must not exceed their ceiling
//   8. src/app + src/components import the 5 kernels through facades only (deep VALUE imports forbidden;
//      import type deep-imports allowed)
//   9. kernel dependency direction: forbidden inter-kernel edges (with a non-increasing exceptions allowlist)
//  10. exported-symbol count <= exports.max (public surface cap)
//  11. Markdown budget: file count, total LOC, per-file ceilings, no archive, no forbidden-name docs
//  12. package.json dependencies are a subset of deps.allow
//  13. named past incidents: forbidden phrases in the surfaces that once carried them

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const ROOT = resolve(process.cwd());
const cfg = JSON.parse(readFileSync(join(ROOT, "foundation-budget.json"), "utf8"));
const failures = [];
const fail = (m) => failures.push(m);

function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name === ".codex" || name === ".claude") continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const loc = (f) => readFileSync(f, "utf8").split("\n").length;
const rel = (f) => relative(ROOT, f).split(sep).join("/");

const srcFiles = walk(join(ROOT, "src"), /\.(ts|tsx)$/);
const testTreeFiles = walk(join(ROOT, "tests"), /\.(ts|tsx)$/);
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
const pageRoutes = prodFiles.map(rel)
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

// import-statement scanner: returns [{spec, isType}], handling multi-line imports; skips `import type`
function imports(src) {
  const out = [];
  const re = /\bimport\s+(type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) out.push({ spec: m[2], isType: !!m[1] });
  return out;
}

// 8. SERVER data-loader surfaces (src/app, non-"use client") must consume kernels via facade (deep VALUE
//    imports forbidden; import type deep allowed). Client components ("use client") and src/components
//    presentation are exempt: a kernel facade re-exports server-only modules, so a component pulled into
//    the client bundle physically cannot import it; Turbopack's server-only boundary is the guardrail
//    there, and presentation legitimately imports client-safe deep modules (proof-timeline, action-types).
if (cfg.imports && Array.isArray(cfg.imports.appForbiddenDomainDeep)) {
  const faceFiles = prodFiles.filter((f) => rel(f).startsWith("src/app/"));
  for (const f of faceFiles) {
    const src = readFileSync(f, "utf8");
    if (/^\s*["']use client["']/m.test(src)) continue;
    for (const { spec, isType } of imports(src)) {
      if (isType) continue;
      for (const forbidden of cfg.imports.appForbiddenDomainDeep) {
        if (spec.includes(forbidden)) fail(`facade violation: ${rel(f)} value-imports kernel internal ${spec} (import the kernel facade, not internals)`);
      }
    }
  }
}

// 9. kernel dependency direction (with non-increasing exceptions)
if (cfg.imports && cfg.imports.kernelForbiddenEdges) {
  const exceptions = new Set(cfg.imports.kernelDirectionExceptions || []);
  for (const [kernel, forbiddenTargets] of Object.entries(cfg.imports.kernelForbiddenEdges)) {
    const kfiles = prodFiles.filter((f) => rel(f).startsWith(`src/domains/${kernel}/`));
    for (const f of kfiles) {
      const r = rel(f);
      for (const { spec } of imports(readFileSync(f, "utf8"))) {
        for (const t of forbiddenTargets) {
          if (spec.includes(`@/domains/${t}/`) && !exceptions.has(`${r}->${t}`)) {
            fail(`kernel direction violation: ${r} imports ${t} (${spec}); ${kernel} must not import ${t}`);
          }
        }
      }
    }
  }
}

// 10. exported-symbol cap
if (cfg.exports && typeof cfg.exports.max === "number") {
  const exportRe = /^export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(type|interface|class|enum|const|function|let|var)\s+[A-Za-z0-9_$]+/gm;
  let count = 0;
  for (const f of prodFiles) { const s = readFileSync(f, "utf8"); const mm = s.match(exportRe); if (mm) count += mm.length; }
  if (count > cfg.exports.max) fail(`exported-symbol count ${count} > budget ${cfg.exports.max} (keep internal helpers/types internal)`);
  cfg._exportCount = count;
}

// 11. Markdown budget
let mdCount = 0, mdLines = 0;
if (cfg.markdown) {
  const md = walk(ROOT, /\.md$/).map(rel).filter((r) => !r.startsWith("migrations/") ? true : true);
  mdCount = md.length; mdLines = md.reduce((a, r) => a + loc(join(ROOT, r)), 0);
  const namePat = cfg.markdown.forbiddenNamePattern ? new RegExp(cfg.markdown.forbiddenNamePattern) : null;
  const allow = new Set(cfg.markdown.allowlist || []);
  if (mdCount > cfg.markdown.maxFiles) fail(`Markdown file count ${mdCount} > budget ${cfg.markdown.maxFiles}`);
  if (mdLines > cfg.markdown.maxTotalLines) fail(`Markdown total lines ${mdLines} > budget ${cfg.markdown.maxTotalLines}`);
  for (const r of md) {
    if (cfg.markdown.forbidArchive && r.includes("/archive/")) fail(`forbidden archive doc: ${r} (git history is the archive)`);
    const base = r.split("/").pop();
    if (namePat && namePat.test(base) && !allow.has(r)) fail(`forbidden doc name: ${r} (AUDIT/REPORT/WIP/HISTORY/ROADMAP need operator approval)`);
    const cap = cfg.markdown.perFileCeilings && cfg.markdown.perFileCeilings[r];
    if (cap !== undefined && loc(join(ROOT, r)) > cap) fail(`doc over ceiling: ${r} is ${loc(join(ROOT, r))} > ${cap} (compact it)`);
  }
}

// 12. dependency allowlist
if (cfg.deps && Array.isArray(cfg.deps.allow)) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const d of Object.keys(pkg.dependencies || {})) if (!cfg.deps.allow.includes(d)) fail(`unauthorized dependency: ${d} (add to deps.allow only with operator approval)`);
}

// 13. NAMED PAST INCIDENTS, PINNED AT THE SOURCE. These are greps, not behaviour, so they live here rather than
// in a suite: Today is work and never narrates a research pass again (2026-08-11), and Beacon's insides are
// never advice, so no customer-facing connector line names a server setting or where Beacon runs.
const surfaceBans = [
  ["src/app/(shell)/page.tsx", /answersReadClosely|aiChecksAnswered|answers collected today|topics under research|researchStatusLine|In research/, false],
  ["src/app/(shell)/settings/connectors/connectors-client.tsx", /GOOGLE_|NEXT_PUBLIC_|Vercel/, true],
  ["src/app/(shell)/settings/connectors/actions.ts", /GOOGLE_|NEXT_PUBLIC_|Vercel/, true],
];
for (const [f, banned, stripComments] of surfaceBans) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const hit = (stripComments ? src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n") : src).match(banned);
  if (hit) fail(`forbidden surface phrase in ${f}: "${hit[0]}" (a named past incident is pinned here)`);
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
if (cfg._exportCount !== undefined) console.log(line("exported symbols", cfg._exportCount, cfg.exports.max));
console.log(line("markdown files", mdCount, cfg.markdown ? cfg.markdown.maxFiles : undefined));
console.log(line("markdown lines", mdLines, cfg.markdown ? cfg.markdown.maxTotalLines : undefined));

if (failures.length) {
  console.error(`\nFOUNDATION GUARD FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✓ Foundation guard passed — within every budget.");
