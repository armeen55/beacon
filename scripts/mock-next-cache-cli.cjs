// Preload script: stub `next/cache` so diagnostic CLI tools that
// import server modules wrapped in `unstable_cache` can run outside
// the Next runtime. Production code is unaffected — this shim is
// only loaded via `--require` from CLI scripts.
//
// `unstable_cache`: passthrough — calling the returned function just
//   invokes the original work. No caching, no Next runtime needed.
// `revalidateTag` / `updateTag` / `revalidatePath`: no-ops.
const Module = require("module");
const origResolve = Module._resolveFilename;
const shimPath = require("path").join(__dirname, "_next-cache-shim.cjs");
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/cache") return shimPath;
  return origResolve.call(this, request, parent, isMain, options);
};
