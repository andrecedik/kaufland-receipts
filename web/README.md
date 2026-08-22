# web/ — shadcn/React variant (site-b)

An A/B alternative to the plain-HTML `site/` generator: same data, same
warm coral/berry-plum color palette, same four pages (receipt list, receipt
detail, item price history, statistics), but built with
[shadcn/ui](https://ui.shadcn.com/) (Radix + Tailwind CSS v4) on Vite +
React + TypeScript, output to `../site-b/`.

## Building

Needs Node `^20.19.0 || >=22.12.0` (Vite 8's bundler, Rolldown, needs
`node:util`'s `styleText` export, missing before Node 20.12). If you use
nvm, `cd web && nvm use` picks up the pinned version in `.nvmrc`
automatically. `npm run build`/`dev` check this themselves and fail with a
clear message on an incompatible Node — otherwise the failure mode is a
cryptic crash deep in `node_modules/rolldown` ("does not provide an export
named 'styleText'"), which is what an old Node version left active in a
shell (e.g. via nvm) looks like.

```sh
# from the repo root — exports web/src/data/receipts.json and copies
# source PDFs into web/public/pdfs/ from the local receipt store
uv run kaufland web-b-data

cd web
nvm use       # if you use nvm — matches .nvmrc
npm install   # first time only
npm run build # writes ../site-b/
```

## Viewing site-b

Unlike `site/`, this **must be served over HTTP** — it can't be opened
directly via `file://`. Vite's build output uses native ES module
`<script type="module">` tags, and Chrome (and other browsers) refuse to
load those under the `file://` origin (a CORS restriction, not a bug in
this project). Serve it with anything static, e.g.:

```sh
cd ../site-b
python3 -m http.server 8000
# open http://localhost:8000
```

Routing is client-side (`HashRouter` — URLs look like `#/receipts/<id>`)
specifically so the built site is a single `index.html` with no server-side
route configuration needed; any static file server works.

## Notable differences from `site/`

- **Data**: baked in at build time from `web/src/data/receipts.json`
  (gitignored — regenerate with `kaufland web-b-data`), not read live.
- **Theme toggle**: same idea (manual light/dark pin, persisted in
  `localStorage`, applied before first paint to avoid a flash), implemented
  with Tailwind's `class` dark-mode strategy (`.dark` on `<html>`) instead
  of a `data-theme` attribute.
- **Charts**: a small hand-built SVG sparkline component (mirrors
  `_svg_sparkline` in the Python site), not a charting library.
