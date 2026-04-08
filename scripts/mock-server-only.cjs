// Preload script: mock "server-only" so Node scripts can use server modules
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") {
    return __filename;
  }
  return origResolve.call(this, request, parent, isMain, options);
};
