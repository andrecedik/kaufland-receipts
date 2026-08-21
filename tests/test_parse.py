"""Parser tests against a synthetic fixture in the real Kaufland format.

The fixture (``fixtures/receipt_synthetic.txt``) carries no personal data but
exercises every line shape: simple, inline-quantity, two-line quantity, two-line
weight, a per-item loyalty discount, a Pfand line, and a final Rabattaktion
discount. If the parser survives all of these and still reconciles to the printed
total, the format logic is sound."""

from decimal import Decimal
from pathlib import Path

import pytest

from kaufland_receipts.parse_pdf import parse_text

FIXTURE = (Path(__file__).parent / "fixtures" / "receipt_synthetic.txt").read_text("utf-8")


def test_fixture_reconciles():
    r = parse_text(FIXTURE)
    assert r.total == Decimal("8.00")
    assert r.line_item_sum() == Decimal("8.00")
    assert r.totals_match()


def test_header_and_id():
    r = parse_text(FIXTURE)
    assert r.purchased_at.isoformat() == "2026-08-07T12:00:00"
    assert r.store.city == "Teststadt"
    assert r.store.postal_code == "12345"
    # Filiale-Kasse-YYYYMMDD-Bon
    assert r.receipt_id == "kaufland-1234-1-20260807-99999"


def test_line_shapes():
    items = {li.name: li for li in parse_text(FIXTURE).line_items}
    # inline quantity
    assert items["Testartikel Zwei"].quantity == Decimal("2")
    assert items["Testartikel Zwei"].unit_price == Decimal("1.50")
    assert items["Testartikel Zwei"].total_price == Decimal("3.00")
    # two-line quantity (name on its own line)
    assert items["Testkaese Gouda"].quantity == Decimal("3")
    assert items["Testkaese Gouda"].total_price == Decimal("3.00")
    # two-line weight
    assert items["Testgemuese kg"].quantity == Decimal("0.500")
    assert items["Testgemuese kg"].total_price == Decimal("1.00")
    # tax classes: A = 19%, B = 7%
    assert items["Pfandartikel"].tax_class == "A"
    assert items["Testartikel Eins"].tax_class == "B"


def test_discounts_are_negative_line_items():
    discounts = [li for li in parse_text(FIXTURE).line_items if li.total_price < 0]
    assert len(discounts) == 2  # per-item + Rabattaktion
    assert all(li.name == "K Card XTRA Rabatt" for li in discounts)


def test_rejects_non_kaufland():
    with pytest.raises(ValueError):
        parse_text("Some other shop\nSumme 5,00\nDatum:01.01.26 Zeit: 10:00:00 Bon:1")
