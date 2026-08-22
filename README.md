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
   uv run kaufland web                         # static HTML site → site/index.html
   ```

   `kaufland web` regenerates a self-contained static site (no server, no
   external assets): a receipt list ordered by date, a detail page per
   receipt, a price-history page per product (with a small chart), and a
   statistics page (monthly totals + trailing 30/182/365-day spend). Open
   `site/index.html` directly in a browser, or serve it locally with
   `python3 -m http.server -d site`. Re-run the command any time to refresh
   it after new receipts land.

Receipts are cached as one JSON file each under
`~/.local/share/kaufland-receipts/receipts/`. Ingestion is idempotent — re-run
`watch`/`ingest` freely.

## A/B site variant (shadcn/React)

[`web/`](web/) is a second frontend on the same data and color palette,
built with [shadcn/ui](https://ui.shadcn.com/) on Vite + React instead of
plain HTML/CSS, output to `site-b/`:

```sh
uv run kaufland web-b-data   # export receipts.json + copy PDFs for web/
cd web && npm install && npm run build
npm run preview               # view it — prints a local URL to open
```

Unlike `site/`, `site-b/` needs a local server — it can't be opened via
`file://`, since Chrome blocks ES module scripts under that origin.
`npm run preview` (from `web/`) is the easiest way to view it; see
[`web/README.md`](web/README.md) for the alternative of serving `site-b/`
directly, and the directory mix-up to avoid there.

## Status

- [x] Shared data model, idempotent store, exporters, monthly rollup (tested)
- [x] PDF ingestion + iCloud watcher — **parser validated against real
      digital-receipt PDFs**; parsed line items reconcile exactly to the printed
      `Summe` (all four line shapes + loyalty discounts + Rabattaktion handled)
- [x] Static HTML site — receipt list, per-receipt detail, per-item price
      history with a chart, monthly/trailing-window statistics
- [x] A/B variant: same site on shadcn/React (`web/` → `site-b/`)
- [ ] Frida/Android capture of `app.kaufland.net` receipt endpoints
- [ ] `auth.py` (cidaas OAuth2 + refresh) and `api.py` auto-sync client
- [ ] Home Assistant (MQTT) + Grocy stock sync

## Dev

```sh
uv sync
uv run pytest      # core logic; no PDF or network needed
```
