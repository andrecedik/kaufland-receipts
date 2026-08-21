"""Tests for the format-independent core: model reconciliation, store idempotency,
and the export/rollup functions. These need no real PDF and no network."""

from datetime import datetime
from decimal import Decimal

from kaufland_receipts.export import (
    append_price_history,
    monthly_summary_markdown,
    to_csv,
)
from kaufland_receipts.models import LineItem, Receipt, Store
from kaufland_receipts.store import ReceiptStore


def _receipt(rid="kaufland-1", total="3.50", when="2026-08-10T14:30:00") -> Receipt:
    return Receipt(
        receipt_id=rid,
        purchased_at=datetime.fromisoformat(when),
        store=Store(name="Kaufland"),
        line_items=[
            LineItem(name="MILCH", quantity=Decimal(2), unit_price=Decimal("1.00"),
                     total_price=Decimal("2.00"), tax_class="A"),
            LineItem(name="BROT", unit_price=Decimal("1.50"),
                     total_price=Decimal("1.50"), tax_class="A"),
        ],
        total=Decimal(total),
    )


def test_totals_reconcile():
    assert _receipt().totals_match()
    bad = _receipt(total="9.99")
    assert not bad.totals_match()


def test_store_is_idempotent(tmp_path):
    store = ReceiptStore(data_dir=tmp_path)
    r = _receipt()
    assert store.save(r) is True          # first write
    assert store.save(r) is False         # second write is a no-op
    assert store.has("kaufland-1")
    assert len(store.all()) == 1


def test_store_roundtrip(tmp_path):
    store = ReceiptStore(data_dir=tmp_path)
    store.save(_receipt())
    loaded = store.load("kaufland-1")
    assert loaded.total == Decimal("3.50")
    assert loaded.line_items[0].name == "MILCH"


def test_csv_has_one_row_per_line_item():
    csv_text = to_csv([_receipt()])
    # header + 2 item rows
    assert len(csv_text.strip().splitlines()) == 3
    assert "MILCH" in csv_text and "BROT" in csv_text


def test_price_history_dedupes(tmp_path):
    log = tmp_path / "prices.jsonl"
    assert append_price_history([_receipt()], log) == 2
    # re-running adds nothing
    assert append_price_history([_receipt()], log) == 0


def test_monthly_summary_groups_by_month():
    md = monthly_summary_markdown([
        _receipt(rid="a", total="3.50", when="2026-08-10T10:00:00"),
        _receipt(rid="b", total="6.50", when="2026-08-20T10:00:00"),
        _receipt(rid="c", total="4.00", when="2026-07-01T10:00:00"),
    ])
    assert "2026-08" in md and "2026-07" in md
    assert "10.00" in md   # August total
    assert "14.00" in md   # grand total
