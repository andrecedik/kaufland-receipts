#!/usr/bin/env node
// Vite 8's default bundler (Rolldown) needs `node:util`'s `styleText`
// export, which is missing on Node < 20.12 -- on an incompatible version
// the failure otherwise surfaces as a cryptic
// "does not provide an export named 'styleText'" crash deep inside
// node_modules instead of a clear message. Checked here explicitly, on
// every `npm run dev`/`build`/`preview` (not just `npm install`), since
// `engine-strict` in .npmrc does not reliably catch a Node version that
// changed *after* install (e.g. switched via nvm in a later shell).
const REQUIRED = "^20.19.0 || >=22.12.0" // must match package.json "engines".node

const [major, minor] = process.versions.node.split(".").map(Number)
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22

if (!ok) {
  console.error(`\nThis project needs Node ${REQUIRED}, found ${process.version}.`)
  console.error(`\nFix: cd web && nvm use   (reads web/.nvmrc)\n`)
  process.exit(1)
}
