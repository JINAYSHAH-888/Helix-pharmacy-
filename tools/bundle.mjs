#!/usr/bin/env node
/**
 * bundle.mjs — resolve #include directives in GLSL into a single source string.
 * Use at build time, or import `bundleShader` directly in a Vite plugin.
 *
 *   node scripts/bundle.mjs lib/gradient/aurora.frag > dist/aurora.frag
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const INCLUDE = /^[ \t]*#include[ \t]+["<]([^">]+)[">][ \t]*$/gm;

export function bundleShader(entry, seen = new Set()) {
  const abs = resolve(entry);
  if (seen.has(abs)) return "";                       // include guard
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  return src.replace(INCLUDE, (_m, p) => bundleShader(resolve(dirname(abs), p), seen));
}

if (import.meta.url === `file://${resolve(process.argv[1])}`) {
  const entry = process.argv[2];
  if (!entry) { console.error("usage: bundle.mjs <shader.frag>"); process.exit(1); }
  process.stdout.write(bundleShader(entry));
}
