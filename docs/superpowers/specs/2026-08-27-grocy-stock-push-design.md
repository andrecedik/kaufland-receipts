# Grocy Stock Push — Design

**Status:** approved, ready for implementation planning

## Goal

Write parsed receipt line items into a user's own Grocy instance as stock, per `CONTEXT.md`'s **Grocy Stock Push** definition: a one-way write, Kaufland-only initially, using data already parsed today — no new parsers or crowd data needed. Per ADR 0002, this is **launch-blocking**: outreach to the self-hosted/Grocy audience (r/selfhosted, r/grocy) waits until this ships, since for that audience it's the actual reason to install the tool, not Price Integrity Check.

Grocy instance for development/testing: `https://grocy.example/` (homelab).

## Non-goals

- **Two-way sync.** `CONTEXT.md` explicitly avoids "Grocy sync" for this term — we only ever write to Grocy, never read stock levels back to reconcile or display them.
- **Automatic unit/size conversion.** Kaufland's `quantity` is pushed to Grocy as-is, trusting it's already expressed in whatever purchase unit the matched Grocy product is configured with. No attempt to reconcile `size_value`/`size_unit` against Grocy's per-product quantity-unit conversion factors. Revisit based on real feedback once the MVP ships — not deeply validated up front, same posture as Price Integrity Check's 5% verdict threshold.
- **Prorating `threshold_coupon_discount` into pushed prices.** Grocy only ever sees face-value prices (`total_price / quantity`); the whole-cart coupon is never distributed across line items. This is a deliberate difference from what a future paid Analytics Surface tier might show ("real" discount-adjusted prices) — Grocy is a dumb stock ledger here, not a place to reproduce that value.
- **Automatic detection of discount/Pfand-return lines** (`K Card XTRA Rabatt`, `Leergut Mopro`, etc.) to exclude them from mapping. These flow through the exact same Product Mapping picker as real products; the user skips them once and the cache (keyed by the stable, repeated raw name string) means they never reprompt. Building a classifier for "is this line a real product" would solve a problem the generic skip-and-cache mechanism already handles.
- **CLI interface.** No `kaufland grocy` subcommand. The Product Mapping picker is inherently interactive (live search-as-you-type against Grocy's catalog) and belongs in the web UI only, consistent with ADR 0002's audience already using the web app + Docker as their primary surface.
- **HA Notification Hook.** Separately scoped per ADR 0003; unrelated to this feature.

## Decisions

- **Decoupled review queue, not blocking at ingest time.** `kaufland watch`/`ingest`, Web Upload, and Folder Watch all complete immediately and fully regardless of Grocy — Folder Watch in particular can't block on interactive input at all (headless polling). Unmapped items accumulate in a queue surfaced on a new web UI page; mapping happens whenever the user gets to it, decoupled from ingestion.
- **Product Mapping is cached locally, not matched live against Grocy's catalog each time.** The first time a raw Kaufland line-item name (e.g. `"H-MILCH 3,5%"`) is seen, the user resolves it once via a picker; that exact string → resolution is cached and reused automatically on every future receipt with the identical string. Chosen over Mealie's live-ingredient-matching approach because Kaufland receipt strings are terse, repeated, abbreviated codes (not natural language) — an exact cached match is both cheaper and more reliable than re-matching live, and it survives the user later renaming the Grocy product. Live search against Grocy's catalog still powers the picker's suggestions during resolution — only the *confirmed* choice gets cached, not a fresh match every time.
- **Skip is a first-class, permanent resolution**, alongside "map to existing product" and "create new product" — needed because receipts contain lines that will never belong in Grocy stock (discount lines, Pfand/Leergut returns, one-off non-food items). Cached the same way as a real mapping, keyed by the same raw name string.
- **Grocy Push Readiness gates per receipt, all-or-nothing.** A receipt only pushes once every one of its line items has a resolved Product Mapping. Chosen over pushing mapped items individually so a receipt's Grocy status stays a simple boolean, not a partial/mixed state.
- **Push fires automatically the moment readiness is reached** — no separate manual "confirm push" step. Reaching readiness is already a deliberate final user action (resolving the last item), so a second confirm click is redundant.
- **Grocy Push Attempt tracks success per line item**, independent of readiness. A push is a sequence of individual Grocy stock-add API calls, not one atomic transaction — if item 3 of 5 fails, items 1–2 are already written to Grocy's stock. A failure surfaces a receipt-level retry action that re-attempts only items without a successful Push Attempt, so already-written stock is never double-counted on retry.
- **Price pushed is `total_price / quantity`.** Not `unit_price` (sometimes null; `total_price` is guaranteed present and already reconciled against the printed total via `totals_match()`).
- **Grocy Product Defaults: one global location + purchase/stock quantity unit**, applied automatically to every product created via the picker's "create new" path — no per-item field prompting. Trade-off: every auto-created product needs the same generic unit/location until the user tidies it up in Grocy's own UI. Kept the "type a name, press enter" flow fast.
- **Config split:** `GROCY_URL` and `GROCY_API_KEY` as environment variables (secrets, consistent with the existing `XDG_DATA_HOME` env-var config pattern and Docker Compose convention). Grocy Product Defaults set through a settings screen in the web UI, which calls Grocy's API to fetch real locations/quantity units so the user picks from human-readable names instead of hand-typing raw Grocy object IDs.

## Data Model

Push-related state is genuinely mutable, cross-process-persistent state (unlike Price Integrity Check's verdicts, which are cheap to recompute at export time) — it needs its own store, mirroring `store.py`'s pattern rather than piggybacking on `export_web_data`.

```python
# grocy.py (new module)

class ProductMapping(BaseModel):
    """One resolved raw-name -> Grocy outcome. Keyed by LineItem.name in GrocyStore."""
    grocy_product_id: int | None  # None means skipped
    skipped: bool = False
    resolved_at: datetime


class LineItemPushState(BaseModel):
    status: str  # "pending" | "pushed" | "failed"
    error: str | None = None
    pushed_at: datetime | None = None
```

Persistence layout (new `GrocyStore`, parallel to `ReceiptStore`, under the existing `XDG_DATA_HOME`-backed data dir):

- `grocy/mappings.json` — single flat file, `dict[str, ProductMapping]` keyed by raw line-item name. One file (not one-per-item) because it's a simple global lookup consulted on every line item of every receipt.
- `grocy/push_state/<receipt_id>.json` — one file per receipt (mirrors `ReceiptStore`'s per-receipt file convention), `dict[int, LineItemPushState]` keyed by line-item index, since each receipt's push state is read/written independently.

## Architecture / Data Flow

- **`GrocyClient`** (new, in `grocy.py`): thin wrapper over Grocy's REST API (`GROCY-API-KEY` header auth) — search products, list locations/quantity units, create a product, add stock to a product. Kept separate from persistence, mirroring the existing `parse_pdf.py` (parsing) / `store.py` (storage) split.
- **`GrocyStore`** (new, in `grocy.py`): owns `mappings.json` and `push_state/`, exposes resolve-mapping and record-push-attempt operations. Computing a receipt's Grocy Push Readiness is a pure function over `GrocyStore` state + a `Receipt`'s line items — not persisted separately.
- **New FastAPI endpoints** (extends `server.py` or a new router module):
  - `GET /api/grocy/pending` — receipts with at least one unresolved line item.
  - `GET /api/grocy/search?q=` — proxies a live product search to Grocy, backing the picker's suggestions.
  - `POST /api/grocy/mappings` — resolve one raw name (map / create-new / skip); if resolving it brings its receipt to Grocy Push Readiness, triggers the push for that receipt server-side in the same request.
  - `POST /api/grocy/receipts/{id}/retry` — re-attempts only line items without a successful Push Attempt.
  - `GET`/`PUT /api/grocy/settings` — connection status + Grocy Product Defaults (fetches live locations/quantity units for the picker; persists the chosen defaults).
- **No change to `export_web_data`** or `receipts.json` — push status is local integration state, not receipt content, and doesn't need Price Integrity Check's "attach to exported JSON" treatment since the new page reads live from the endpoints above instead.
- **New web UI page**, `GrocyPage.tsx` (route `/grocy`, added to `App.tsx` and `Layout.tsx`'s nav) — lists receipts pending mapping, renders the picker per unresolved line item (search-as-you-type against `/api/grocy/search`, map / create-new / skip), and shows retry affordances for receipts with a failed Push Attempt. A settings section (or separate `GrocySettingsPage.tsx`) for Grocy Product Defaults.

## Documentation Updates

- README needs a note (flagged during design, not yet written) explaining that discount and Pfand/Leergut lines aren't auto-detected — the user skips them once in the picker and the mapping cache remembers it for every future receipt. Write this alongside the Grocy Stock Push section the README's Status checklist already anticipates ("Home Assistant (MQTT) + Grocy stock sync").
- `README.md`'s Status checklist item "Home Assistant (MQTT) + Grocy stock sync" should be split — Grocy Stock Push and the (separately scoped, still-pending) HA Notification Hook are different features per `CONTEXT.md` and ADR 0003.

## Testing Strategy

- `GrocyClient`: tests against a mocked HTTP layer (`httpx.MockTransport`, already available via the existing `httpx` dev dependency used for FastAPI's `TestClient`) — no dependency on the real `https://grocy.example/` instance, matching this project's existing rule against relying on gitignored/external fixtures in automated tests.
- `GrocyStore`: direct read/write round-trip tests against a temp data dir, mirroring `tests/test_store.py`'s existing pattern for `ReceiptStore`.
- Readiness computation: synthetic `Receipt`/`LineItem` fixtures (no `samples/` dependency, matching Price Integrity Check's testing approach) covering all-resolved, partially-resolved, and all-skipped cases.
- Push Attempt / retry: a mocked `GrocyClient` that fails on a specific call, verifying only unresolved-or-failed items are retried, not already-succeeded ones.
- FastAPI endpoints: `TestClient`-based tests per new endpoint, following `tests/test_server.py`'s existing conventions.

## Open items for the implementation plan

- Exact Grocy REST API endpoints/payload shapes for product search, product creation, and stock-add (needs confirming against the live `https://grocy.example/` instance's API docs/OpenAPI spec during implementation).
- Whether `httpx` needs promoting from the `dev` dependency group to a main dependency (currently only used for FastAPI's `TestClient`; `GrocyClient` needs it at runtime).
- Exact picker UI/UX on `GrocyPage.tsx` (search debounce, keyboard interaction for "press enter to create") — frontend-design-level detail, not a backend architecture question.
- Whether the settings screen for Grocy Product Defaults is its own page/route or a section within `GrocyPage.tsx`.
