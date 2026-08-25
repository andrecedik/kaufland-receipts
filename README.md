# kaufland-receipts

Pull **your own** Kaufland digital receipts (Digitale Kassenbons) out of the app
and into local, structured data — for spending analysis, price-history tracking,
[me-brain](../), and Home Assistant / Grocy.

> Unofficial and unaffiliated with Kaufland. This is a personal-data /
> interoperability tool: it only ever handles your own receipts, and the active
> path parses PDFs *you* export from the app — it does not talk to Kaufland's
> servers at all.

## Why it works this way

Kaufland shows digital receipts only inside the app; there is no website and no
public API. Interception of the app (2026-08-21) showed the receipts host
`app.kaufland.net` is **certificate-pinned**, so the automated route is on hold.
The auth side, however, is clean cidaas OAuth2 with `offline_access` — a fully
automated client is feasible once the pinned endpoints are recovered on an
Android emulator. See [`docs/api.md`](docs/api.md).

Until then, the **PDF pipeline** below is the route in use. It is guaranteed,
fully offline, and shares its data model with the future API client, so nothing
downstream changes when automation lands.

## PDF pipeline

1. In the Kaufland app: **Digitale Kassenbons → open a receipt → als PDF
   speichern → share to iCloud Drive** into a folder named `digital-receipts`.
2. On the Mac:

   ```sh
   uv run kaufland watch            # check iCloud/digital-receipts once, ingest new PDFs, exit
   uv run kaufland watch --no-once  # or keep polling in the background instead
   # or one-shot:
   uv run kaufland ingest ~/path/to/a-receipt.pdf
   ```

3. Use the data:

   ```sh
   uv run kaufland list                       # what's stored
   uv run kaufland export --format csv -o export.csv
   uv run kaufland prices                      # append to prices.jsonl
   uv run kaufland summary                     # monthly rollup (Markdown)
   ```

Receipts are cached as one JSON file each under
`~/.local/share/kaufland-receipts/receipts/`. Ingestion is idempotent — re-run
`watch`/`ingest` freely.

## Web Upload — alternative to the iCloud watcher

Folder Watch (above) only works on a Mac with iCloud Drive. `kaufland serve`
runs a small local HTTP server instead, so a receipt can be uploaded straight
from the browser's Upload page — the ingestion path for a NAS/Docker
deployment, or just an alternative to the iCloud folder on a Mac. Run it from
the **repository root** (its `--web-dir` default is the relative path `web`,
same convention as `kaufland web-b-data` below):

```sh
uv run kaufland serve --web-dir web   # binds 127.0.0.1:8000 by default
cd web && npm install && npm run dev  # separate terminal — proxies /api to the server above
```

Open the printed `npm run dev` URL and go to **Upload**. A successful upload
re-exports `web/public/data/receipts.json` immediately — no separate
`web-b-data --watch` needed alongside it.

`--host`/`--port` are configurable, but there is **no authentication** on the
upload endpoint — only bind `--host 0.0.0.0` (to reach it from other devices)
behind a trusted network or a reverse proxy that adds auth; the default
`127.0.0.1` keeps it loopback-only.

## Site (shadcn/React) — primary

[`web/`](web/) is the primary way to browse receipts: a Vite + React +
TypeScript app built with [shadcn/ui](https://ui.shadcn.com/), output to
`site-b/`. It won an A/B comparison against a plain-HTML static site (below)
on 2026-08-22 for its richer UI (search/sort, Cmd+K command palette, charts).

For day-to-day use, run it as a dev server instead of building — no build
step, and receipts.json is fetched at runtime (not baked in), so a browser
refresh always shows the latest data:

```sh
uv run kaufland web-b-data --watch   # keeps re-exporting as you ingest receipts
cd web && npm install && npm run dev # separate terminal — prints a local URL to open
```

`npm run dev` gives instant hot-reload on code changes; refresh the browser
to pick up new receipt data (no rebuild either way). Only build (below) when
producing a static copy to deploy or hand off — see [`web/README.md`](web/README.md)
for the build/preview flow and the directory mix-up to avoid there.

## Static HTML site — fallback, not actively developed

`site/`, built from `src/kaufland_receipts/web.py`, is a self-contained
static site (no server, no build step, no external assets) with the same
pages as the React variant. It lost the A/B comparison but is kept working
as an option to fall back to if a pre-rendered, dependency-free site is ever
needed again — it is not getting new features going forward.

```sh
uv run kaufland web   # regenerate → site/index.html
```

Open `site/index.html` directly in a browser, or serve it locally with
`python3 -m http.server -d site`.

## Status

- [x] Shared data model, idempotent store, exporters, monthly rollup (tested)
- [x] PDF ingestion + iCloud watcher — **parser validated against real
      digital-receipt PDFs**; parsed line items reconcile exactly to the printed
      `Summe` (all four line shapes + loyalty discounts + Rabattaktion handled)
- [x] Web Upload (`kaufland serve` + browser Upload page) — alternative
      ingestion path for non-Mac/NAS use; no auth on the endpoint yet, so it's
      loopback-only by default (see above)
- [x] Static HTML site — kept as fallback, not actively developed (see above)
- [x] Primary site: shadcn/React (`web/` → `site-b/`) — won the A/B comparison
      2026-08-22
- [ ] Frida/Android capture of `app.kaufland.net` receipt endpoints
- [ ] `auth.py` (cidaas OAuth2 + refresh) and `api.py` auto-sync client
- [ ] Home Assistant (MQTT) + Grocy stock sync

## Dev

```sh
uv sync
uv run pytest      # core logic; no PDF or network needed
```
