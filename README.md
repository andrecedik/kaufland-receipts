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

## Site (shadcn/React) — primary

[`web/`](web/) is the primary way to browse receipts: a Vite + React +
TypeScript app built with [shadcn/ui](https://ui.shadcn.com/), output to
`site-b/`. It won an A/B comparison against a plain-HTML static site (below)
on 2026-08-22 for its richer UI (search/sort, Cmd+K command palette, charts).

```sh
uv run kaufland web-b-data   # export receipts.json + copy PDFs for web/
cd web && npm install && npm run build
npm run preview               # view it — prints a local URL to open
```

It needs a local server — it can't be opened via `file://`, since Chrome
blocks ES module scripts under that origin. `npm run preview` (from `web/`)
is the easiest way to view it; see [`web/README.md`](web/README.md) for the
alternative of serving `site-b/` directly, and the directory mix-up to avoid
there.

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
