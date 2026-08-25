# Price Integrity Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a purchase that had a discount applied, compute and display whether it was actually a genuine reduction — comparing the effective price paid against the median of the user's own prior purchases of that item at that store.

**Architecture:** A parser fix separates the whole-cart `Rabattaktion` coupon from per-item discount lines (today they're indistinguishable in the data). A new `price_integrity.py` module pairs each product line with its attached per-item discount and computes verdicts against purchase history. `export_web_data` attaches verdicts to the exported JSON (following the existing `pdf_available` enrichment pattern) — no changes to the core `Receipt`/`LineItem` models beyond the one new field the parser fix needs. The frontend renders a badge next to qualifying line items.

**Tech Stack:** Python (pydantic models, `statistics.median`), existing FastAPI/export pipeline, React/TypeScript frontend.

**Spec:** `docs/superpowers/specs/2026-08-25-price-integrity-check-design.md`

## Global Constraints

- Money fields are `Decimal` throughout the Python side; the frontend receives them as JSON strings and parses via the existing `num()` helper (`web/src/lib/receipts.ts`) — never introduce floats on the Python side.
- Verdicts are computed backend-side and attached to exported JSON, never computed client-side — this project has a documented incident of business logic drifting between a Python/TS twin (`_svg_sparkline` vs `Sparkline.tsx`) because only one side had test coverage.
- Tests must not depend on `samples/` (gitignored real receipt PDFs) — this bit the Web Upload plan's execution (a task was dispatched against a brief assuming a real gitignored sample existed, and failed on a fresh checkout). All new tests in this plan construct fixtures directly (text fixture edits for parser tests, direct `LineItem`/`Receipt` construction for `price_integrity.py` tests) — no dependency on `samples/`.
- Frontend `web/` commands need `nvm use system` (not `v20.18.0`) — `package.json`'s `engines` requires Node `^20.19.0 || >=22.12.0`, verified in earlier sessions on this machine (`nvm use system` resolves to v22.22.3).
- `Receipt.threshold_coupon_discount` (new field, Task 1) is **not** added to the frontend TypeScript types — nothing in this plan's frontend scope reads it, and doing so would force unrelated updates to 4 existing test files' `Receipt` builder literals (`receipts.test.ts`, `receipts.derived.test.ts`, `ReceiptDetailPage.test.tsx`, `ReceiptsPage.test.tsx`) for a field with zero display purpose — YAGNI.

---

### Task 1: Parser fix — separate the whole-cart coupon from per-item discounts

**Files:**
- Modify: `src/kaufland_receipts/models.py`
- Modify: `src/kaufland_receipts/parse_pdf.py`
- Modify: `tests/test_parse.py`

**Interfaces:**
- Produces: `Receipt.threshold_coupon_discount: Decimal | None` (new field); `_parse_line_items(lines: list[str]) -> tuple[list[LineItem], Decimal | None]` (signature change — was `-> list[LineItem]`)

Real sample receipts (gitignored, `samples/*.pdf` — not available in a fresh checkout, referenced here for context only) confirmed: every inline `K Card XTRA Rabatt` line directly follows exactly one product line (including three consecutive `Pringles` items, each with its own individual discount line). The one exception is a final discount inside the `Rabattaktion` block, between `Zwischensumme` and `Summe` — a K-Card-linked, manually-activated-in-app coupon that triggers once your cart total crosses a spend threshold, confirmed in real data to use the identical name (`K Card XTRA Rabatt`) as per-item discounts, so only its position (after `Zwischensumme`) distinguishes it. Today neither `Zwischensumme` nor the `Rabattaktion` divider produce a `LineItem` — the parser's loop just doesn't break on them — so this cart-level discount silently lands in `line_items`, positionally indistinguishable from a per-item one.

- [ ] **Step 1: Write the failing tests**

In `tests/test_parse.py`, replace the existing `test_discounts_are_negative_line_items` function (currently asserts `len(discounts) == 3`) with:

```python
def test_discounts_are_negative_line_items():
    discounts = [li for li in parse_text(FIXTURE).line_items if li.tax_class is None]
    assert len(discounts) == 2  # per-item Rabatt, Mengenrabatt -- the Rabattaktion
    # block's final K Card XTRA Rabatt is threshold_coupon_discount, not a line item
    assert all(li.total_price < 0 for li in discounts)
    assert {li.name for li in discounts} == {"K Card XTRA Rabatt", "Mengenrabatt"}
```

Then append a new test:

```python
def test_rabattaktion_discount_is_separated_from_line_items():
    r = parse_text(FIXTURE)
    assert r.threshold_coupon_discount == Decimal("-0.75")
    # not double-counted as a line item
    assert sum(1 for li in r.line_items if li.name == "K Card XTRA Rabatt") == 1
    # still reconciles: line items + the coupon = the printed total
    assert r.line_item_sum() == r.total
    assert r.totals_match()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_parse.py -v`
Expected: `test_discounts_are_negative_line_items` FAILs (currently 3 discounts, not 2); `test_rabattaktion_discount_is_separated_from_line_items` FAILs with `AttributeError: 'Receipt' object has no attribute 'threshold_coupon_discount'`

- [ ] **Step 3: Add the model field and fix `line_item_sum`**

In `src/kaufland_receipts/models.py`, add to the `Receipt` class (after the existing `source_file` field):

```python
    # The Rabattaktion block's whole-cart, K-Card-linked, manually-activated
    # spend-threshold coupon (e.g. "save EUR 5 once your cart crosses EUR 50")
    # -- never attributable to a single item, kept separate from line_items
    # for exactly that reason. None when a receipt has no such coupon.
    threshold_coupon_discount: Decimal | None = None
```

Replace the existing `line_item_sum` method:

```python
    def line_item_sum(self) -> Decimal:
        """Sum of line totals plus the whole-cart threshold coupon, if any --
        should equal ``total`` on a well-parsed receipt."""
        return (
            sum((li.total_price for li in self.line_items), Decimal(0))
            + (self.threshold_coupon_discount or Decimal(0))
        )
```

- [ ] **Step 4: Change `_parse_line_items` to separate the two discount kinds**

In `src/kaufland_receipts/parse_pdf.py`, add a new regex near the existing `_SUMME` pattern (around line 104):

```python
_ZWISCHENSUMME = re.compile(r"^Zwischensumme\s+\d+,\d{2}$")
```

Replace the `_parse_line_items` function signature, docstring, and body:

```python
def _parse_line_items(lines: list[str]) -> tuple[list[LineItem], Decimal | None]:
    """Walk the body between the 'Preis EUR' header and 'Summe'.

    Products are captured at their printed price; per-item discount lines
    (see ``_DISCOUNT``) are captured as negative line items -- this is what
    makes the line-item sum reconcile to the printed total. Discount lines
    seen after ``Zwischensumme`` belong to the ``Rabattaktion`` block's
    whole-cart threshold coupon, not any single product, so they're summed
    separately instead of becoming a LineItem (see
    ``Receipt.threshold_coupon_discount``).
    """
    items: list[LineItem] = []
    pending_name: str | None = None
    in_body = False
    past_zwischensumme = False
    threshold_coupon_discount: Decimal | None = None

    for ln in lines:
        if "Preis EUR" in ln:
            in_body = True
            continue
        if not in_body:
            continue
        if _SUMME.match(ln):  # end of the item region
            break
        if _ZWISCHENSUMME.match(ln):
            past_zwischensumme = True
            continue

        if m := _DISCOUNT.match(ln):
            if past_zwischensumme:
                amt = _money(m["amt"])
                threshold_coupon_discount = (
                    amt if threshold_coupon_discount is None
                    else threshold_coupon_discount + amt
                )
                continue
            size_value, size_unit = _size_for(m["name"])
            items.append(LineItem(
                name=m["name"], total_price=_money(m["amt"]),
                size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue
        if m := _INLINE_Q.match(ln):
            name = m["name"].strip()
            total = _money(m["amt"])
            size_value, size_unit = _size_for(name)
            items.append(LineItem(
                name=name, quantity=Decimal(m["qty"]),
                unit_price=_signed_unit_price(m["unit"], total), total_price=total,
                tax_class=m["tax"], size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue
        if m := _INLINE_W.match(ln):
            name = m["name"].strip()
            weight = _money(m["w"])
            size_value, size_unit = _size_for(name, weight=weight)
            items.append(LineItem(
                name=name, quantity=weight, total_price=_money(m["amt"]),
                tax_class=m["tax"], size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue
        if (m := _CONT_Q.match(ln)) and pending_name:
            total = _money(m["amt"])
            size_value, size_unit = _size_for(pending_name)
            items.append(LineItem(
                name=pending_name, quantity=Decimal(m["qty"]),
                unit_price=_signed_unit_price(m["unit"], total), total_price=total,
                tax_class=m["tax"], size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue
        if (m := _CONT_W.match(ln)) and pending_name:
            weight = _money(m["w"])
            size_value, size_unit = _size_for(pending_name, weight=weight)
            items.append(LineItem(
                name=pending_name, quantity=weight,
                total_price=_money(m["amt"]), tax_class=m["tax"],
                size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue
        if m := _SIMPLE.match(ln):
            name = m["name"].strip()
            size_value, size_unit = _size_for(name)
            items.append(LineItem(
                name=name, unit_price=_money(m["amt"]),
                total_price=_money(m["amt"]), tax_class=m["tax"],
                size_value=size_value, size_unit=size_unit))
            pending_name = None
            continue

        # A bare product-name line (no price yet) — buffer it for the
        # continuation line that carries the quantity/weight and price.
        if re.search(r"[A-Za-zÄÖÜäöü]", ln) and not any(
            kw in ln for kw in ("Zwischensumme", "Steuer", "Kaufland Pay", "----")
        ):
            pending_name = ln
    return items, threshold_coupon_discount
```

Update the one call site — in `parse_text` (same file), replace:

```python
        line_items=_parse_line_items(lines),
```

with:

```python
        line_items=line_items,
        threshold_coupon_discount=threshold_coupon_discount,
```

and immediately before the `return Receipt(` statement in `parse_text`, add:

```python
    line_items, threshold_coupon_discount = _parse_line_items(lines)

```

(i.e. call `_parse_line_items` once, unpack both return values, then reference `line_items`/`threshold_coupon_discount` in the `Receipt(...)` construction — don't call `_parse_line_items(lines)` inline inside the constructor call anymore.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_parse.py -v`
Expected: PASS (all tests, including the two from Step 1)

- [ ] **Step 6: Run the full test suite (regression check)**

Run: `uv run pytest -v`
Expected: PASS — confirms no other test depended on the Rabattaktion discount being in `line_items`

- [ ] **Step 7: Commit**

```bash
git add src/kaufland_receipts/models.py src/kaufland_receipts/parse_pdf.py tests/test_parse.py
git commit -m "fix: separate the Rabattaktion whole-cart coupon from per-item discounts"
```

---

### Task 2: `price_integrity.py` — per-item discount attribution and verdicts

**Files:**
- Create: `src/kaufland_receipts/price_integrity.py`
- Create: `tests/test_price_integrity.py`

**Interfaces:**
- Consumes: `LineItem`, `Receipt` (`models.py`, unchanged except Task 1's new field)
- Produces: `class Verdict(BaseModel)` with fields `median_price: Decimal`, `current_price: Decimal`, `percent_delta: Decimal`, `label: str`, `observation_count: int`; `attach_item_discounts(line_items: list[LineItem]) -> list[tuple[int, LineItem, Decimal]]` (index into the original `line_items` list, the product `LineItem`, and its attached discount total — `Decimal(0)` if none); `compute_verdicts(receipts: list[Receipt]) -> dict[str, dict[int, Verdict]]` (`receipt_id -> {line_item index -> Verdict}`)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_price_integrity.py`:

```python
"""Tests for Price Integrity Check (see CONTEXT.md's Price Integrity Check
term and docs/superpowers/specs/2026-08-25-price-integrity-check-design.md).
No PDF/text parsing involved -- these operate on Receipt/LineItem objects
directly, so nothing here depends on samples/ (gitignored real receipts)."""

from datetime import datetime
from decimal import Decimal

from kaufland_receipts.models import LineItem, Receipt, Store
from kaufland_receipts.price_integrity import attach_item_discounts, compute_verdicts


def _product(name="Milch", total_price="2.00", quantity="1", tax_class="B") -> LineItem:
    return LineItem(
        name=name, quantity=Decimal(quantity), unit_price=Decimal(total_price) / Decimal(quantity),
        total_price=Decimal(total_price), tax_class=tax_class,
    )


def _discount(name="K Card XTRA Rabatt", amount="-0.30") -> LineItem:
    return LineItem(name=name, total_price=Decimal(amount))


def _receipt(rid: str, when: str, line_items: list[LineItem], store_street="Teststraße 1") -> Receipt:
    total = sum((li.total_price for li in line_items), Decimal(0))
    return Receipt(
        receipt_id=rid, purchased_at=datetime.fromisoformat(when),
        store=Store(name="Kaufland", street=store_street),
        line_items=line_items, total=total,
    )


def test_attach_item_discounts_pairs_each_item_with_its_following_discount():
    a = _product(name="A", total_price="2.00")
    disc = _discount(amount="-0.50")
    b = _product(name="B", total_price="1.00")
    pairs = attach_item_discounts([a, disc, b])

    assert pairs == [(0, a, Decimal("-0.50")), (2, b, Decimal("0"))]


def test_attach_item_discounts_sums_consecutive_discounts_on_one_item():
    a = _product(name="A", total_price="2.00")
    disc1 = _discount(name="Mengenrabatt", amount="-0.20")
    disc2 = _discount(name="K Card XTRA Rabatt", amount="-0.30")
    pairs = attach_item_discounts([a, disc1, disc2])

    assert pairs == [(0, a, Decimal("-0.50"))]


def test_compute_verdicts_requires_two_prior_observations():
    r1 = _receipt("r1", "2026-01-01T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-08T10:00:00", [_product(total_price="1.70"), _discount()])

    verdicts = compute_verdicts([r1, r2])

    assert verdicts == {}  # only 1 prior observation for r2's discounted purchase


def test_compute_verdicts_labels_a_clear_price_drop_genuine():
    r1 = _receipt("r1", "2026-01-01T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-08T10:00:00", [_product(total_price="2.00")])
    # product's own printed total_price is 2.00 (matching r1/r2); the
    # attached -0.30 discount brings the effective price to 1.70 (-15%)
    r3 = _receipt("r3", "2026-01-15T10:00:00", [_product(total_price="2.00"), _discount(amount="-0.30")])

    verdicts = compute_verdicts([r1, r2, r3])

    v = verdicts["r3"][0]
    assert v.median_price == Decimal("2.00")
    assert v.current_price == Decimal("1.70")
    assert v.percent_delta == Decimal("-15.0")
    assert v.label == "genuine"
    assert v.observation_count == 2


def test_compute_verdicts_labels_a_small_difference_marginal():
    r1 = _receipt("r1", "2026-01-01T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-08T10:00:00", [_product(total_price="2.00")])
    # printed total_price 2.00, attached -0.05 discount -> effective 1.95
    # (-2.5%, strictly between the -5/+5 label boundaries)
    r3 = _receipt("r3", "2026-01-15T10:00:00", [_product(total_price="2.00"), _discount(amount="-0.05")])

    verdicts = compute_verdicts([r1, r2, r3])

    assert verdicts["r3"][0].label == "marginal"


def test_compute_verdicts_labels_a_price_increase_worse_than_usual():
    r1 = _receipt("r1", "2026-01-01T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-08T10:00:00", [_product(total_price="2.00")])
    # still has a discount attached, but the price is still higher than usual
    r3 = _receipt("r3", "2026-01-15T10:00:00", [_product(total_price="2.20"), _discount(amount="-0.05")])

    verdicts = compute_verdicts([r1, r2, r3])

    assert verdicts["r3"][0].label == "worse_than_usual"


def test_compute_verdicts_scopes_by_store():
    # Two prior purchases at a DIFFERENT store must not count toward this
    # store's median.
    other_store = _receipt("o1", "2026-01-01T10:00:00", [_product(total_price="1.00")], store_street="Elsewhere 1")
    other_store2 = _receipt("o2", "2026-01-02T10:00:00", [_product(total_price="1.00")], store_street="Elsewhere 1")
    r1 = _receipt("r1", "2026-01-08T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-15T10:00:00", [_product(total_price="1.70"), _discount(amount="-0.30")])

    verdicts = compute_verdicts([other_store, other_store2, r1, r2])

    assert verdicts == {}  # only r1 is prior history at r2's store -- still just 1 observation


def test_compute_verdicts_skips_purchases_with_no_discount():
    r1 = _receipt("r1", "2026-01-01T10:00:00", [_product(total_price="2.00")])
    r2 = _receipt("r2", "2026-01-08T10:00:00", [_product(total_price="2.00")])
    r3 = _receipt("r3", "2026-01-15T10:00:00", [_product(total_price="2.00")])  # no discount

    verdicts = compute_verdicts([r1, r2, r3])

    assert verdicts == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_price_integrity.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaufland_receipts.price_integrity'`

- [ ] **Step 3: Implement the module**

Create `src/kaufland_receipts/price_integrity.py`:

```python
"""Price Integrity Check: is a discounted purchase actually a genuine
reduction, based on the user's own purchase history at that store.

See CONTEXT.md's Price Integrity Check term and
docs/superpowers/specs/2026-08-25-price-integrity-check-design.md.

Genuine price-drop detection only -- not shrinkflation detection. Most
Kaufland-printed item names carry no pack-size information at all, and when
a size IS embedded in a name and it changes, the name string itself changes
(so a shrunk product shows up as a new, historyless item, not a false
"price drop" on the same one) -- there's no reliable signal in this data
source to catch same-name-smaller-pack shrinkflation.
"""

from __future__ import annotations

import statistics
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from .models import LineItem, Receipt


class Verdict(BaseModel):
    median_price: Decimal
    current_price: Decimal
    percent_delta: Decimal  # negative = cheaper than usual
    label: str  # "genuine" | "marginal" | "worse_than_usual"
    observation_count: int


def attach_item_discounts(line_items: list[LineItem]) -> list[tuple[int, LineItem, Decimal]]:
    """Pairs each product line (with its index in ``line_items``) with its
    attached per-item discount total (``Decimal(0)`` if none).

    Discount lines are recognised by ``tax_class`` being unset -- discount
    lines never carry a tax class (see parse_pdf.py's ``_DISCOUNT``
    pattern), unlike every product/refund line. Consecutive discount lines
    immediately following one product are all summed into that product's
    attachment -- not observed on real receipts (every sample has exactly
    one discount per item), but not ruled out either, so a second one isn't
    silently dropped.
    """
    pairs: list[tuple[int, LineItem, Decimal]] = []
    i = 0
    while i < len(line_items):
        item = line_items[i]
        if item.tax_class is None:
            # A discount line with nothing preceding it to attach to --
            # skip, it contributes no purchase to attach the discount to.
            i += 1
            continue
        item_index = i
        i += 1
        discount_total = Decimal(0)
        while i < len(line_items) and line_items[i].tax_class is None:
            discount_total += line_items[i].total_price
            i += 1
        pairs.append((item_index, item, discount_total))
    return pairs


def _effective_unit_price(item: LineItem, discount_total: Decimal) -> Decimal:
    """Effective price per unit (or per kg for weight-priced lines) once
    the attached discount is accounted for. ``total_price`` is already the
    real cost and ``quantity`` is already a count or a weight-in-kg
    depending on the line shape, so this one formula covers both cases."""
    return (item.total_price + discount_total) / item.quantity


def compute_verdicts(receipts: list[Receipt]) -> dict[str, dict[int, Verdict]]:
    """receipt_id -> {line_item index -> Verdict}, for every qualifying line
    item (had an attached discount, >=2 prior observations of the same item
    name at the same store) across all receipts.

    Store scoping uses the most specific identifier available
    (``Store.street``, falling back to ``Store.name``), matching
    CONTEXT.md's "at the same store" wording -- distinct from the
    frontend's ``itemPriceHistory()``, which aggregates across all stores
    for a different purpose (a general price-history chart).
    """
    sorted_receipts = sorted(receipts, key=lambda r: r.purchased_at)
    per_receipt_pairs: dict[str, list[tuple[int, LineItem, Decimal]]] = {}
    observations: dict[tuple[str, str], list[tuple[datetime, Decimal]]] = {}

    for r in sorted_receipts:
        store_key = r.store.street or r.store.name
        pairs = attach_item_discounts(r.line_items)
        per_receipt_pairs[r.receipt_id] = pairs
        for _index, item, discount_total in pairs:
            price = _effective_unit_price(item, discount_total)
            key = (item.name, store_key)
            observations.setdefault(key, []).append((r.purchased_at, price))

    verdicts: dict[str, dict[int, Verdict]] = {}
    for r in sorted_receipts:
        store_key = r.store.street or r.store.name
        for index, item, discount_total in per_receipt_pairs[r.receipt_id]:
            if discount_total == 0:
                continue  # no discount on this purchase -- nothing to verify
            key = (item.name, store_key)
            prior = [p for (t, p) in observations[key] if t < r.purchased_at]
            if len(prior) < 2:
                continue
            median_price = statistics.median(prior)
            if median_price == 0:
                continue  # degenerate -- can't compute a meaningful delta
            current_price = _effective_unit_price(item, discount_total)
            percent_delta = (current_price - median_price) / median_price * 100
            if percent_delta <= -5:
                label = "genuine"
            elif percent_delta < 5:
                label = "marginal"
            else:
                label = "worse_than_usual"
            verdicts.setdefault(r.receipt_id, {})[index] = Verdict(
                median_price=median_price, current_price=current_price,
                percent_delta=percent_delta, label=label,
                observation_count=len(prior),
            )
    return verdicts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_price_integrity.py -v`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Task 1's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/price_integrity.py tests/test_price_integrity.py
git commit -m "feat: compute Price Integrity Check verdicts"
```

---

### Task 3: Wire verdicts into `export_web_data`

**Files:**
- Modify: `src/kaufland_receipts/export.py`
- Modify: `tests/test_store.py`

**Interfaces:**
- Consumes: `compute_verdicts(receipts: list[Receipt]) -> dict[str, dict[int, Verdict]]`, `Verdict` (`price_integrity.py`, Task 2)
- Produces: no new signature — `export_web_data`'s written `receipts.json` now has a `price_verdict` key on each qualifying line item's serialized dict (absent entirely for non-qualifying ones)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_store.py` (add `import json` to the top-of-file imports if not already present — check first, this file may already import it):

```python
def _milch_receipt(rid: str, when: str, total_price: str, discount: str | None = None) -> Receipt:
    """A receipt with one Milch line item (and, optionally, an attached
    per-item discount) at a fixed store location -- built directly rather
    than via the module's existing `_receipt()` helper, since that helper
    hardcodes its own MILCH/BROT line items and doesn't accept overrides."""
    line_items = [
        LineItem(name="Milch", quantity=Decimal(1), unit_price=Decimal(total_price),
                  total_price=Decimal(total_price), tax_class="B"),
    ]
    if discount is not None:
        line_items.append(LineItem(name="K Card XTRA Rabatt", total_price=Decimal(discount)))
    total = sum((li.total_price for li in line_items), Decimal(0))
    return Receipt(
        receipt_id=rid, purchased_at=datetime.fromisoformat(when),
        store=Store(name="Kaufland", street="Teststraße 1"),
        line_items=line_items, total=total,
    )


def test_export_web_data_attaches_price_verdicts(tmp_path):
    r1 = _milch_receipt("r1", "2026-01-01T10:00:00", total_price="2.00")
    r2 = _milch_receipt("r2", "2026-01-08T10:00:00", total_price="2.00")
    r3 = _milch_receipt("r3", "2026-01-15T10:00:00", total_price="2.00", discount="-0.30")

    web_dir = tmp_path / "web"
    export_web_data([r1, r2, r3], web_dir)

    data = json.loads((web_dir / "public" / "data" / "receipts.json").read_text("utf-8"))
    r3_record = next(rec for rec in data if rec["receipt_id"] == "r3")
    verdict = r3_record["line_items"][0]["price_verdict"]
    assert verdict["label"] == "genuine"
    assert verdict["median_price"] == "2.00"
    assert verdict["current_price"] == "1.70"
    # the discount line itself never gets a verdict
    assert "price_verdict" not in r3_record["line_items"][1]
    # receipts with no qualifying discount have no price_verdict key at all
    r1_record = next(rec for rec in data if rec["receipt_id"] == "r1")
    assert "price_verdict" not in r1_record["line_items"][0]
```

`tests/test_store.py` already imports `LineItem`, `Receipt`, `Store` from `kaufland_receipts.models` and `datetime`/`Decimal` — no new imports needed for those. Only `import json` may need adding (check first; this file may already import it for another test).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_store.py::test_export_web_data_attaches_price_verdicts -v`
Expected: FAIL — `KeyError: 'price_verdict'`, since nothing attaches it yet

- [ ] **Step 3: Wire `compute_verdicts` into the export**

In `src/kaufland_receipts/export.py`, add to the imports:

```python
from .price_integrity import compute_verdicts
```

Replace the body of `export_web_data` from `copied = 0` through the `records.append(record)` line:

```python
    copied = 0
    records = []
    verdicts = compute_verdicts(receipts)
    for r in receipts:
        record = r.model_dump(mode="json")
        pdf_available = bool(r.source_file and Path(r.source_file).exists())
        record["pdf_available"] = pdf_available
        for index, verdict in verdicts.get(r.receipt_id, {}).items():
            record["line_items"][index]["price_verdict"] = verdict.model_dump(mode="json")
        if pdf_available:
            shutil.copy2(r.source_file, pdfs_dir / f"{r.receipt_id}.pdf")
            copied += 1
        records.append(record)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_store.py -v`
Expected: PASS (including the pre-existing `test_export_web_data_writes_receipts_and_copies_available_pdfs`, unaffected since it has no discounted repeat purchases)

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Tasks 1-2's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/export.py tests/test_store.py
git commit -m "feat: attach Price Integrity Check verdicts to exported receipt JSON"
```

---

### Task 4: Frontend — render the verdict on the Receipt Detail page

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/receipts.ts`
- Modify: `web/src/pages/ReceiptDetailPage.tsx`
- Create: `web/src/lib/receipts.priceVerdict.test.ts`
- Modify: `web/src/pages/ReceiptDetailPage.test.tsx`

**Interfaces:**
- Consumes: the `price_verdict` JSON shape from Task 3 — `{median_price: string, current_price: string, percent_delta: string, label: string, observation_count: number}`, present only on qualifying line items
- Produces: `PriceVerdict` TS interface (`types.ts`); `formatVerdict(v: PriceVerdict): string` (`receipts.ts`)

- [ ] **Step 1: Add the TypeScript type**

In `web/src/lib/types.ts`, add above the `LineItem` interface:

```ts
export interface PriceVerdict {
  median_price: string
  current_price: string
  percent_delta: string
  label: string
  observation_count: number
}
```

Add one field to the existing `LineItem` interface (after `size_unit`):

```ts
  price_verdict?: PriceVerdict
```

- [ ] **Step 2: Write the failing test for `formatVerdict`**

Create `web/src/lib/receipts.priceVerdict.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { formatVerdict } from "@/lib/receipts"
import type { PriceVerdict } from "@/lib/types"

function verdict(overrides: Partial<PriceVerdict>): PriceVerdict {
  return {
    median_price: "2.00",
    current_price: "1.70",
    percent_delta: "-15.0",
    label: "genuine",
    observation_count: 2,
    ...overrides,
  }
}

describe("formatVerdict", () => {
  it("describes a genuine discount", () => {
    expect(formatVerdict(verdict({ label: "genuine", percent_delta: "-15.0" }))).toBe(
      "15% below your usual price",
    )
  })

  it("describes a marginal discount", () => {
    expect(formatVerdict(verdict({ label: "marginal", percent_delta: "-2.5" }))).toBe(
      "Only 3% off — not much of a bargain",
    )
  })

  it("describes a price that's worse than usual", () => {
    expect(formatVerdict(verdict({ label: "worse_than_usual", percent_delta: "10.0" }))).toBe(
      "10% above your usual price",
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/receipts.priceVerdict.test.ts`
Expected: FAIL — `formatVerdict is not exported`

- [ ] **Step 4: Implement `formatVerdict`**

In `web/src/lib/receipts.ts`, add to the imports:

```ts
import type { LineItem, PriceVerdict, Receipt } from "@/lib/types"
```

(This replaces the existing `import type { LineItem, Receipt } from "@/lib/types"` line — check the current import first and merge `PriceVerdict` into it rather than duplicating the import statement.)

Add this function (near `fmtMoney`, matching that formatting-helper cluster):

```ts
export function formatVerdict(v: PriceVerdict): string {
  const pct = Math.round(Math.abs(num(v.percent_delta)))
  if (v.label === "genuine") return `${pct}% below your usual price`
  if (v.label === "worse_than_usual") return `${pct}% above your usual price`
  return `Only ${pct}% off — not much of a bargain`
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/receipts.priceVerdict.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Write the failing test for the rendered badge**

Append to `web/src/pages/ReceiptDetailPage.test.tsx` (inside a new `describe` block, after the existing `describe("ReceiptDetailPage ingestion-info drawer", ...)` block):

```tsx
describe("ReceiptDetailPage price verdicts", () => {
  it("shows a verdict badge next to a line item that has one", () => {
    receipts.push(
      receipt({
        line_items: [
          lineItem({
            name: "Milch",
            total_price: "1.70",
            price_verdict: {
              median_price: "2.00",
              current_price: "1.70",
              percent_delta: "-15.0",
              label: "genuine",
              observation_count: 2,
            },
          }),
        ],
        total: "1.70",
      }),
    )
    renderDetail("kaufland-test-1")

    expect(screen.getByText("15% below your usual price")).toBeTruthy()
  })

  it("shows nothing extra for a line item with no verdict", () => {
    receipts.push(receipt({ line_items: [lineItem({ name: "Brot", total_price: "1.50" })], total: "1.50" }))
    renderDetail("kaufland-test-1")

    expect(screen.queryByText(/your usual price/)).toBeNull()
    expect(screen.queryByText(/not much of a bargain/)).toBeNull()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/ReceiptDetailPage.test.tsx`
Expected: FAIL — the new `describe` block's first test can't find the text, since nothing renders it yet

- [ ] **Step 8: Render the verdict badge**

In `web/src/pages/ReceiptDetailPage.tsx`, add to the imports:

```tsx
import { fmtMoney, formatVerdict, itemSlug, lineItemSum, mergeDuplicateLines, num, receipts, totalSaved, totalsMatch } from "@/lib/receipts"
```

(This replaces the existing import line from `@/lib/receipts` — merge `formatVerdict` into it rather than adding a second import statement.)

In the table body's item-name cell, add the verdict badge after the existing size-value badge (the `{li.size_value !== null && (...)}` block):

```tsx
                <TableCell>
                  <Link to={`/items/${itemSlug(li.name)}`} className="text-primary hover:underline">
                    {li.name}
                  </Link>
                  {li.size_value !== null && (
                    <Badge variant="secondary" className="ml-2">
                      {Number(li.size_value)} {li.size_unit}
                    </Badge>
                  )}
                  {li.price_verdict && (
                    <Badge variant={li.price_verdict.label === "genuine" ? "default" : "secondary"} className="ml-2">
                      {formatVerdict(li.price_verdict)}
                    </Badge>
                  )}
                </TableCell>
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/ReceiptDetailPage.test.tsx`
Expected: PASS (all tests, including the pre-existing drawer ones and the two new ones)

- [ ] **Step 10: Run the full frontend suite and lint**

Run: `cd web && npm test && npm run lint`
Expected: PASS, no new lint errors (the two pre-existing `only-export-components` warnings in unrelated files are not from this change)

- [ ] **Step 11: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/receipts.ts web/src/lib/receipts.priceVerdict.test.ts web/src/pages/ReceiptDetailPage.tsx web/src/pages/ReceiptDetailPage.test.tsx
git commit -m "feat: show Price Integrity Check verdicts on the Receipt Detail page"
```

---

### Task 5: Correct `CONTEXT.md`'s Price Integrity Check term

**Files:**
- Modify: `CONTEXT.md`

No code changes, no tests — this is a documentation correction now that the feature exists and its real scope is known.

The design spec flagged this correction as a possible ADR candidate. It doesn't meet the bar on reflection: an ADR is for a decision (a trade-off between real alternatives), and this is a factual correction (a capability turned out to be infeasible against real data), not a choice between options. The corrected `CONTEXT.md` term below already carries the "why," which is what a reader actually needs — no separate ADR.

- [ ] **Step 1: Update the term**

In `CONTEXT.md`, find the **Price Integrity Check** term:

```markdown
**Price Integrity Check**:
Comparing a product's current price/unit-price against its own price history at the same store, to flag whether an advertised sale is a genuine reduction (as opposed to a shrunk pack size or a fake discount). Uses only the user's own historical data — no other users' data required.
_Avoid_: Price trends, bargain detection
```

Replace it with:

```markdown
**Price Integrity Check**:
Comparing a product's current effective price (after any attached discount) against the median of the user's own prior purchases of that item at the same store, to flag whether an advertised sale is a genuine reduction. Uses only the user's own historical data — no other users' data required. Not shrinkflation detection: most Kaufland-printed item names carry no pack-size information, and when a size is embedded in a name and changes, the name string itself changes — so there's no reliable signal in this data source to catch a same-name-smaller-pack case.
_Avoid_: Price trends, bargain detection, shrinkflation detection
```

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: correct Price Integrity Check's shrinkflation claim in CONTEXT.md"
```
