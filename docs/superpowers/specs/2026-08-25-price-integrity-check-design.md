# Price Integrity Check — Design

**Status:** approved, ready for implementation planning

## Goal

Answer, for a purchase that had a discount applied: "is this actually a genuine reduction, or not much of a bargain?" — using only the user's own purchase history at that store. This is the core product feature `CONTEXT.md` defines but nothing in the codebase implements yet; it's more foundational than Grocy/HA integration, since the (deferred) HA Notification Hook is scoped to publish this feature's *computed events*, not raw data.

## Non-goals

- **Shrinkflation detection is not a deliverable, and the term's definition is being corrected.** Traced through the real receipt data: most Kaufland-printed item names carry no pack-size information at all, and when a size *is* embedded in the name and it changes, the name string itself changes — so a genuinely shrunk product just shows up as a new, historyless item name rather than a false "price drop" on the same item. There's no reliable signal in this data source to catch same-name-smaller-pack shrinkflation. `CONTEXT.md`'s Price Integrity Check definition needs a follow-up correction to drop this claim (see Documentation Updates below).
- Cross-store or cross-retailer comparison — out of scope by definition (`CONTEXT.md`'s Cross-Retailer Price Comparison, separately deferred pending crowd data).
- Flagging "you're paying more than usual" on purchases with **no** discount applied — a related but different feature (a price-alert, not a sale-genuineness check). Only line items with an attached per-item discount get evaluated.
- Surfacing verdicts on the Item Page's price-history sparkline, or a dedicated "all your discounts, ranked" summary view — good future extensions, not this spec.
- Any HA/Grocy integration — separately scoped, and per ADR 0003 the HA Notification Hook depends on this feature existing first, not the reverse.

## Decisions

- **Computed backend-side (Python), not client-side.** This project's own history has a documented incident of exactly this class of bug: `_svg_sparkline` (Python) and `Sparkline.tsx` (TS) drifted because business logic lived in two places and only one had test coverage. "Is this a genuine discount" is business logic, not a display concern — computing it once in Python avoids that risk, and sets up cleanly for the HA Notification Hook later (which needs backend-computed events regardless).
- **Baseline: median of prior purchases**, not the most recent price or the all-time minimum. Median is resistant to a retailer inflating the price right before a "sale" (a real, documented tactic) — the most-recent-price baseline is trivially gamed by exactly that. The all-time-minimum baseline sets an unreasonably high bar that would fail most genuine discounts.
- **Minimum 2 prior observations required.** Fewer than that, no verdict is computed — "not enough history yet" is an honest state, not something to paper over with a guess from a single data point.
- **Grouped by (item name, store location), not item name alone.** The existing frontend `itemPriceHistory()` aggregates across all stores, which is fine for its own purpose (a general price-history chart) — Price Integrity Check needs `CONTEXT.md`'s literal "at the same store" scoping, so it groups independently, using the most specific store identifier available (`Store.street`, falling back to `Store.name`).
- **Trigger: only line items with an attached per-item discount.** Matches `CONTEXT.md`'s literal wording ("flag whether an *advertised* sale is a genuine reduction") — a purchase with no discount isn't answering the question this feature exists to answer.
- **Output: the actual percentage delta, plus a convenience label — not a hidden-threshold binary verdict.** A pure binary "genuine/fake" call requires picking one specific cutoff percentage that decides everyone's answer; showing the real number ("12% below your usual price") is more honest about what the tool actually knows and lets the user apply their own judgment. The label is a scannability convenience layered on top of the number, not a replacement for it.
- **Surfaced inline on the Receipt Detail page**, next to each line item that had a discount — the natural moment to want to know "was this actually worth it."
- **Verdicts attach to the exported JSON, not the core models.** `export_web_data` already has a precedent for this: it enriches each serialized receipt with a `pdf_available` field that isn't part of the `Receipt`/`LineItem` Pydantic models. Verdicts follow the same pattern — computed and attached during export, keeping "what Kaufland printed" (the models) cleanly separate from "our own computed opinion about it" (the verdict), consistent with `CONTEXT.md`'s Analytics Surface principle.

## A parser fix this depends on

Traced a real structural gap while designing the per-item discount-attribution logic: the parser currently has no way to distinguish a **per-item** `K Card XTRA Rabatt` line (which directly follows exactly one product line — confirmed 1:1 across all 3 real sample receipts, including three consecutive `Pringles` items each getting their own individual discount line) from the **whole-cart** discount inside the `Rabattaktion` block (a K Card-linked, manually-activated-in-app coupon that triggers once your cart total crosses a spend threshold — confirmed against real receipt data, where it appears once between `Zwischensumme` and `Summe`).

Today, neither `Zwischensumme` nor the `Rabattaktion` divider produce a `LineItem` — they're silently skipped by the parser's regex patterns — so the cart-level discount ends up positionally indistinguishable from a per-item one in the flat `line_items` list: it just looks like it followed whatever the last product happened to be. Building item attribution on top of that as-is would misattribute the whole-cart coupon to one essentially-random item on every receipt that has one.

**Fix:** add `Receipt.threshold_coupon_discount: Decimal | None` (new field, `models.py`), captured during parsing from the `Rabattaktion` block instead of falling into `line_items`. `totals_match()`'s reconciliation keeps working since this still counts toward the total, just via a dedicated field. `line_items` then only ever contains genuinely per-item discount lines, and the "attach to the immediately preceding product line" rule (below) becomes reliable.

## Algorithm

**1. Per-item discount attribution** (new module, `src/kaufland_receipts/price_integrity.py`): walk `Receipt.line_items` in order. For each product line, if the immediately following line is a discount line (`K Card XTRA Rabatt` / `Mengenrabatt` / `Artikelrabatt` — the existing discount-line shapes, now guaranteed not to include the cart-level coupon since that's pulled into its own field), attach it — `effective_total_price = total_price + discount.total_price` (discount is already negative). Consecutive discount lines following one product are all attached (defensive — not observed in the 3 real samples, but not ruled out either).

**2. Effective unit price:**
- If `unit_price` is present (fixed-pack items, Kaufland prints an explicit per-unit price): `effective_unit_price = effective_total_price / quantity`.
- If `unit_price` is absent (weight-priced items — produce/deli sold by kg, only `total_price` + `quantity`-as-weight exist): `effective_unit_price = effective_total_price / quantity` where `quantity` is the weight in kg — this normalization is what makes weight-priced purchases comparable at all across visits (a 0.3kg and a 0.65kg purchase of the same produce are never comparable as raw totals).

**3. Verdict, per qualifying line item:**
- Collect all prior purchases (excluding the current one) of the same item name at the same store location, with an `effective_unit_price` computed as above.
- If fewer than 2 prior observations: no verdict (field omitted).
- Otherwise: `median_price = median(prior effective_unit_prices)`, `percent_delta = (effective_unit_price - median_price) / median_price * 100`.
- Label: `genuine` if `percent_delta <= -5`, `marginal` if `-5 < percent_delta < 5`, `worse_than_usual` if `percent_delta >= 5`. (5% is a starting threshold, not deeply validated — worth flagging as an easy-to-tune constant in the implementation, not a hardcoded magic number buried in logic.)

## Data Model

```python
# models.py — new field on Receipt
threshold_coupon_discount: Decimal | None = None  # the Rabattaktion block's
    # whole-cart, K-Card-linked, manually-activated spend-threshold coupon —
    # never attributable to a single item, kept separate from line_items
    # for exactly that reason.
```

```python
# price_integrity.py — new module
class Verdict(BaseModel):
    median_price: Decimal
    current_price: Decimal
    percent_delta: Decimal  # negative = cheaper than usual
    label: str  # "genuine" | "marginal" | "worse_than_usual"
    observation_count: int  # how many prior purchases the median was based on

def attach_item_discounts(line_items: list[LineItem]) -> list[tuple[LineItem, Decimal]]:
    """Pairs each product line with its attached discount total (0 if none)."""

def compute_verdicts(receipts: list[Receipt]) -> dict[str, dict[int, Verdict]]:
    """receipt_id -> {line_item index -> Verdict}, for every qualifying line
    item (had an attached discount, >=2 prior observations) across all
    receipts. Called once per export, not per receipt, since a verdict for
    the Nth purchase needs to see the first N-1."""
```

## Architecture / Data Flow

`export_web_data` (the existing function, unchanged in name/signature) gains one addition: after building each receipt's JSON dict (already enriched with `pdf_available`), it looks up that receipt's verdicts (computed once via `compute_verdicts(store.all())` before the per-receipt loop, not recomputed per receipt) and adds a `price_verdict` key to each qualifying line item's serialized dict:

```json
{
  "name": "K.Grillkäse Gouda",
  "total_price": "4.58",
  ...
  "price_verdict": {
    "median_price": "2.55",
    "current_price": "2.06",
    "percent_delta": -19.2,
    "label": "genuine",
    "observation_count": 4
  }
}
```

Line items without a qualifying discount, or without enough history, simply have no `price_verdict` key — the frontend renders nothing extra for those, no special-casing needed beyond "key present or not."

## Frontend

Minimal, additive change to `ReceiptDetailPage.tsx`: if a line item's JSON has a `price_verdict`, render it next to that line (e.g. a small badge/text: "19% below your usual price" / "Only 2% off — not much of a bargain" / "3% above what you usually pay"). `web/src/lib/types.ts`'s `LineItem` type gains an optional `price_verdict` field matching the shape above.

## Documentation Updates

- `CONTEXT.md`'s **Price Integrity Check** term: drop the "as opposed to a shrunk pack size" shrinkflation claim per the Non-goals section above; reframe as genuine-price-drop detection with weight-priced-item normalization.
- New ADR candidate: the shrinkflation-detection scope correction is a real, documented finding worth recording (surprising without context, real trade-off — the term's original definition overclaimed based on an assumption that didn't hold up against real data) — write as part of the implementation plan's first task, or as a standalone doc update alongside the `CONTEXT.md` edit.

## Testing Strategy

Real sample receipts (`samples/*.pdf`, gitignored) already demonstrate every discount-adjacency pattern needed (per-item, stacked-adjacent hypothetically, cart-level). Synthetic fixture-based tests (matching this project's existing `tests/fixtures/receipt_synthetic.txt` pattern) should cover: per-item discount attachment, weight-priced normalization, the cart-level `Rabattaktion` discount being excluded from `line_items` and correctly landing in `threshold_coupon_discount`, the 2-observation minimum, and the `genuine`/`marginal`/`worse_than_usual` label boundaries.

## Open items for the implementation plan

- Exact regex/parsing changes needed in `parse_pdf.py` to capture the `Rabattaktion` block's amount into `threshold_coupon_discount` instead of `line_items` — the plan should trace the current `_parse_line_items` loop precisely and show the exact diff.
- Whether `compute_verdicts` needs any caching/memoization for larger receipt stores, or whether a full recompute per export is fine at current/expected data volumes (likely fine — deferred to the plan to confirm against real store sizes).
- Exact badge/label copy and visual treatment on `ReceiptDetailPage.tsx` (frontend-design-level detail, not a backend architecture question).
