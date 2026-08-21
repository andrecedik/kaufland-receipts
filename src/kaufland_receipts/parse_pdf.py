"""Parse a Kaufland digital-receipt PDF into a :class:`Receipt`.

The app's "als PDF speichern" export is a real text-layer PDF, so we extract
text with :mod:`pypdf` (no OCR) and apply layout rules.

.. warning::
   The regexes below are PROVISIONAL. They are seeded from the community parser
   `fbsgn/kassenbon-analyzer` (which targets photographed paper receipts) and
   MUST be validated and corrected against a real Kaufland *digital* PDF export,
   whose layout differs. Every format-specific constant is tagged ``# FORMAT``
   so it is easy to find and fix once a sample is in hand.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader

from .models import LineItem, Receipt, Store


def _money(raw: str) -> Decimal:
    """German number format -> Decimal. '21,83' -> Decimal('21.83')."""
    return Decimal(raw.replace(".", "").replace(",", "."))


def extract_text(pdf_path: Path) -> str:
    """Pull the full text layer out of the PDF, page by page."""
    reader = PdfReader(str(pdf_path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def is_kaufland(text: str) -> bool:
    head = "\n".join(text.splitlines()[:15])
    return "kaufland" in head.lower()


# --- FORMAT: line-item / total / date patterns (validate against real PDF) ---

# NAME  UNIT_PRICE  [€ x QTY  LINE_TOTAL]  TAX(A|B)
_ITEM_RE = re.compile(
    r"^(?P<name>[A-ZÄÖÜ][A-ZÄÖÜ&.\s\-\d,X]*?)\s+"
    r"(?P<unit>-?\d+,\d{2})"
    r"(?:\s*€\s*x\s*(?P<qty>\d+)\s+(?P<line>-?\d+,\d{2}))?"
    r"\s*\*?(?P<tax>[AB])W?$"
)
_TOTAL_RE = re.compile(r"summe\s+€?\s*(?P<total>-?\d+,\d{2})", re.IGNORECASE)  # FORMAT
_DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{2,4})\s+(\d{2}):(\d{2})")  # FORMAT
# A digital receipt should carry a fiscal/receipt number we can use as a stable
# id. Guessed labels — correct once we see the real PDF.
_RECEIPT_NO_RE = re.compile(
    r"(?:Bon[- ]?Nr\.?|Beleg[- ]?Nr\.?|Trace[- ]?Nr\.?)[:\s]*([0-9]+)",
    re.IGNORECASE,
)  # FORMAT


def _parse_date(text: str) -> datetime | None:
    m = _DATE_RE.search(text)
    if not m:
        return None
    dd, mm, yy, hh, mi = m.groups()
    year = int(yy) if len(yy) == 4 else 2000 + int(yy)
    return datetime(year, int(mm), int(dd), int(hh), int(mi))


def _parse_line_items(text: str) -> list[LineItem]:
    items: list[LineItem] = []
    for line in text.splitlines():
        m = _ITEM_RE.match(line.strip())
        if not m:
            continue
        unit = _money(m["unit"])
        qty = Decimal(m["qty"]) if m["qty"] else Decimal(1)
        line_total = _money(m["line"]) if m["line"] else unit
        items.append(
            LineItem(
                name=m["name"].strip(),
                quantity=qty,
                unit_price=unit,
                total_price=line_total,
                tax_class=m["tax"],
            )
        )
    return items


def _derive_receipt_id(text: str, purchased_at: datetime, total: Decimal) -> str:
    """Prefer the printed receipt number; fall back to a content hash.

    The fallback keys on date+total so the same receipt yields the same id on
    re-parse, keeping the store idempotent even without a receipt number.
    """
    m = _RECEIPT_NO_RE.search(text)
    if m:
        return f"kaufland-{m.group(1)}"
    stamp = purchased_at.strftime("%Y%m%dT%H%M")
    digest = hashlib.sha256(f"{stamp}|{total}".encode()).hexdigest()[:12]
    return f"kaufland-{stamp}-{digest}"


def parse_pdf(pdf_path: Path) -> Receipt:
    """Parse one receipt PDF into a :class:`Receipt`.

    Raises ``ValueError`` if the file is not a recognisable Kaufland receipt or
    if the mandatory total/date cannot be found — better to fail loudly than to
    store a half-parsed receipt.
    """
    pdf_path = Path(pdf_path)
    text = extract_text(pdf_path)

    if not is_kaufland(text):
        raise ValueError(f"{pdf_path.name}: does not look like a Kaufland receipt")

    purchased_at = _parse_date(text)
    if purchased_at is None:
        raise ValueError(f"{pdf_path.name}: could not find a purchase date")

    total_match = _TOTAL_RE.search(text)
    if not total_match:
        raise ValueError(f"{pdf_path.name}: could not find the total (SUMME)")
    total = _money(total_match["total"])

    return Receipt(
        receipt_id=_derive_receipt_id(text, purchased_at, total),
        purchased_at=purchased_at,
        store=Store(),
        line_items=_parse_line_items(text),
        total=total,
        source="pdf",
        source_file=str(pdf_path),
    )
