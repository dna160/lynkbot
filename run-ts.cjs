/**
 * TypeScript require() hook using ts.transpileModule().
 * Pure JS — no esbuild, no spawning, no hang.
 * Usage: node -r ./run-ts.cjs apps/api/src/index.ts
 * 
 * Requires: TYPESCRIPT_LIB env var or finds typescript relative to the entry file.
 */
const fs   = require('fs');
const path = require('path');
const Module = require('module');

// Locate typescript relative to our entry point or fall back to global
function loadTs() {
  const candidates = [
    path.join(__dirname, 'apps/api/node_modules/typescript'),
    path.join(__dirname, 'apps/worker/node_modules/typescript'),
    path.join(__dirname, 'node_modules/typescript'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return require(c);
    }
  }
  return require('typescript');
}

const ts = loadTs();

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  strict: false,
};

// Hook .ts and .tsx files
['.ts', '.tsx'].forEach(ext => {
  Module._extensions[ext] = function(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, { compilerOptions, fileName: filename });
    module._compile(result.outputText, filename);
  };
});
