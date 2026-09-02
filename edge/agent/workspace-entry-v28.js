'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const target = require.resolve('./workspace-entry');
let source = fs.readFileSync(target, 'utf8');

const originalRedirect = `function redirect(res, location, headers = {}) {\n  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });\n  res.end();\n}`;
const fixedRedirect = `function redirect(res, location, headers = {}) {\n  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });\n  res.end();\n  return true;\n}`;

if (!source.includes(originalRedirect)) {
  throw new Error('VANTIX_EDGE_WORKSPACE_V28_REDIRECT_PATCH_TARGET_MISSING');
}

source = source.replace(originalRedirect, fixedRedirect);

if (!source.includes('return true;\n}\n\nasync function readJson')) {
  throw new Error('VANTIX_EDGE_WORKSPACE_V28_REDIRECT_PATCH_NOT_APPLIED');
}

const patched = new Module(target, module.parent);
patched.filename = target;
patched.paths = Module._nodeModulePaths(path.dirname(target));
require.cache[target] = patched;
patched._compile(source, target);

module.exports = patched.exports;
