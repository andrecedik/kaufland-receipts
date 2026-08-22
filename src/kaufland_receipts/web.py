"""Static HTML site generator.

Reads everything from the local :class:`ReceiptStore` and writes a
self-contained, pre-generated site: no server, no build step beyond running
this once. Regenerate by re-running ``kaufland web``.

Pages:

* ``index.html`` — every receipt, newest first, with its total.
* ``receipts/<id>.html`` — one page per receipt, line items included.
* ``items/<slug>.html`` — price history for one product across all receipts.
* ``stats.html`` — monthly spending + trailing 1/6/12-month totals.

Deliberately no JS framework and no external assets — plain HTML/CSS plus a
handful of hand-built SVG sparklines, so the output opens straight from disk
(``file://``) or any static file server.
"""

from __future__ import annotations

import html
import re
import shutil
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from .models import LineItem, Receipt

STYLE_CSS = """\
:root {
  color-scheme: light dark;
  --bg: #fff8f2;
  --fg: #2e2126;
  --muted: #81666d;
  --border: #f4ded2;
  --accent: #c34017;
  --row-alt: #fdeee3;
  --row-hover: #fbe1ce;
  --thead-bg: #7a2e3d;
  --thead-fg: #fff3e8;
  --match: #3c7b3b;
  --mismatch: #c23350;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #241a22;
    --fg: #fbede6;
    --muted: #c7a0a8;
    --border: #4a2e3a;
    --accent: #ff7a50;
    --row-alt: #2e2029;
    --row-hover: #3a2733;
    --thead-bg: #8c3a4a;
    --match: #7ed17a;
    --mismatch: #ff6e8a;
  }
}
:root[data-theme="dark"] {
  --bg: #241a22;
  --fg: #fbede6;
  --muted: #c7a0a8;
  --border: #4a2e3a;
  --accent: #ff7a50;
  --row-alt: #2e2029;
  --row-hover: #3a2733;
  --thead-bg: #8c3a4a;
  --match: #7ed17a;
  --mismatch: #ff6e8a;
}
* { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  margin: 0;
  padding: 2rem 1.5rem 4rem;
}
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.15rem; margin-top: 2rem; }
.subtitle { color: var(--muted); margin-top: 0; margin-bottom: 1.5rem; font-size: 0.95rem; }
nav.tabs {
  display: flex;
  gap: 1.75rem;
  margin-bottom: 1.75rem;
  border-bottom: 1px solid var(--border);
}
nav.tabs a {
  display: inline-block;
  padding: 0 0.1rem 0.75rem;
  margin-bottom: -1px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
}
nav.tabs a:hover { color: var(--fg); text-decoration: none; }
nav.tabs a.active { color: var(--fg); border-bottom-color: var(--accent); }
nav.tabs .spacer { flex: 1; }
#theme-toggle {
  align-self: flex-start;
  margin-bottom: 0.75rem;
  width: 2rem;
  height: 2rem;
  line-height: 2rem;
  text-align: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--row-alt);
  color: var(--fg);
  cursor: pointer;
  font-size: 1rem;
  font-family: inherit;
}
#theme-toggle:hover { background: var(--row-hover); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 1rem; font-size: 0.92rem; border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 0.85rem 1rem; }
thead th { background: var(--thead-bg); color: var(--thead-fg); font-weight: 600; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.02em; border-bottom: none; }
tbody tr:nth-child(even) { background: var(--row-alt); }
tbody tr:hover { background: var(--row-hover); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; }
tfoot tr:first-child td { border-top: 2px solid var(--border); padding-top: 0.85rem; }
.badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 1rem; font-size: 0.75rem; background: var(--row-alt); color: var(--muted); }
.mismatch { color: var(--mismatch); font-weight: 600; }
.match { color: var(--match); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
.card { border: 1px solid var(--border); border-radius: 10px; padding: 1rem; }
.card .value { font-size: 1.4rem; font-weight: 700; }
.card .label { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.02em; }
.back { display: inline-block; margin-bottom: 1rem; font-size: 0.9rem; }
.chart { margin: 1rem 0 2rem; }
.chart svg { width: 100%; max-width: 600px; height: auto; display: block; }
.footer-note { color: var(--muted); font-size: 0.8rem; margin-top: 3rem; }
"""


def _merge_duplicate_lines(line_items: list[LineItem]) -> list[LineItem]:
    """Combine lines with the same name and unit price into one, summing quantity.

    Kaufland receipts print separate lines for repeated pickups of the same
    article at the same price rather than bumping the quantity themselves;
    merging those back is unambiguous. Lines without a unit price (loyalty
    discounts, weight-priced items) are left as-is.
    """
    merged: list[LineItem] = []
    index: dict[tuple[str, Decimal], int] = {}
    for li in line_items:
        if li.unit_price is None:
            merged.append(li)
            continue
        key = (li.name, li.unit_price)
        if key in index:
            existing = merged[index[key]]
            new_qty = existing.quantity + li.quantity
            merged[index[key]] = existing.model_copy(
                update={
                    "quantity": new_qty,
                    "total_price": existing.unit_price * new_qty,
                    "article_number": existing.article_number or li.article_number,
                }
            )
        else:
            index[key] = len(merged)
            merged.append(li)
    return merged


def _total_saved(line_items: list[LineItem]) -> Decimal:
    """Sum of discount lines: K Card XTRA Rabatt, Mengenrabatt, Artikelrabatt,
    and any other discount type Kaufland prints in that shape.

    Discounts are negative line items with no tax class (see ``_DISCOUNT`` in
    parse_pdf.py); that's what distinguishes them from Pfand/Leergut refunds,
    which are also negative but always carry a tax class and are money back
    for a returned deposit, not a saving.
    """
    return -sum(
        (li.total_price for li in line_items if li.total_price < 0 and li.tax_class is None),
        Decimal(0),
    )


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return slug or "item"


def _fmt_money(amount: Decimal, currency: str = "EUR") -> str:
    return f"{amount:.2f} {currency}"


def _fmt_date(d: date) -> str:
    """21 Aug 2026 -- human, day-first, unambiguous; not ISO's 2026-08-21."""
    return f"{d.day} {d.strftime('%b %Y')}"


def _fmt_datetime(dt: datetime) -> str:
    """21 Aug 2026, 21:03"""
    return f"{_fmt_date(dt)}, {dt:%H:%M}"


def _fmt_month(year_month: str) -> str:
    """'2026-08' -> 'August 2026'."""
    return datetime.strptime(year_month, "%Y-%m").strftime("%B %Y")


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


_TABS = [("receipts", "index.html", "Receipts"), ("stats", "stats.html", "Statistics")]

# Sets data-theme as early as possible (before first paint) to avoid a flash
# of the wrong theme, and wires up the toggle button once the DOM is ready.
# A manual choice (stored in localStorage) always wins over the OS setting.
THEME_SCRIPT = """\
(function () {
  var KEY = "kr-theme";
  var root = document.documentElement;
  var stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);

  function current() {
    var attr = root.getAttribute("data-theme");
    if (attr) return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function paint(btn) {
    var t = current();
    btn.textContent = t === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    paint(btn);
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem(KEY, next);
      paint(btn);
    });
  });
})();
"""


def _page(title: str, body: str, *, prefix: str = "", active: str = "receipts") -> str:
    tabs = "".join(
        f'<a class="{"active" if key == active else ""}" href="{prefix}{href}">{label}</a>'
        for key, href, label in _TABS
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(title)}</title>
<link rel="stylesheet" href="{prefix}style.css">
<script>{THEME_SCRIPT}</script>
</head>
<body>
<main>
<nav class="tabs">
{tabs}
<span class="spacer"></span>
<button id="theme-toggle" type="button" aria-label="Toggle color theme">&#127769;</button>
</nav>
{body}
<p class="footer-note">Generated by kaufland-receipts &middot; {_fmt_datetime(datetime.now())}</p>
</main>
</body>
</html>
"""


def _svg_sparkline(points: list[tuple[date, Decimal]], *, width: int = 600, height: int = 180) -> str:
    if not points:
        return ""
    pad_l, pad_r, pad_t, pad_b = 40, 20, 20, 30
    inner_w = width - pad_l - pad_r
    inner_h = height - pad_t - pad_b

    dates = [d for d, _ in points]
    prices = [p for _, p in points]
    min_d, max_d = min(dates), max(dates)
    min_p, max_p = min(prices), max(prices)
    if min_p == max_p:
        min_p, max_p = min_p - Decimal("0.10"), max_p + Decimal("0.10")
    d_span = (max_d - min_d).days or 1
    p_span = float(max_p - min_p)

    def x_of(d: date) -> float:
        return pad_l + inner_w * ((d - min_d).days / d_span)

    def y_of(p: Decimal) -> float:
        return pad_t + inner_h * (1 - (float(p) - float(min_p)) / p_span)

    coords = [(x_of(d), y_of(p)) for d, p in points]
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)

    circles = []
    for (d, p), (x, y) in zip(points, coords):
        circles.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="var(--accent)">'
            f"<title>{_fmt_date(d)}: {p:.2f} EUR</title></circle>"
        )

    y_min_label = f'<text x="4" y="{y_of(max_p):.1f}" font-size="11" fill="var(--muted)">{max_p:.2f}</text>'
    y_max_label = f'<text x="4" y="{y_of(min_p):.1f}" font-size="11" fill="var(--muted)">{min_p:.2f}</text>'
    if min_d == max_d:
        # Only one date in range -- a separate label at each end would just
        # print the same date twice.
        x_labels = (
            f'<text x="{(pad_l + width - pad_r) / 2:.1f}" y="{height - 8}" font-size="11" '
            f'fill="var(--muted)" text-anchor="middle">{_fmt_date(min_d)}</text>'
        )
    else:
        x_labels = (
            f'<text x="{pad_l}" y="{height - 8}" font-size="11" fill="var(--muted)">{_fmt_date(min_d)}</text>'
            f'<text x="{width - pad_r}" y="{height - 8}" font-size="11" '
            f'fill="var(--muted)" text-anchor="end">{_fmt_date(max_d)}</text>'
        )

    return f"""<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
<polyline points="{poly}" fill="none" stroke="var(--accent)" stroke-width="2"/>
{''.join(circles)}
{y_min_label}{y_max_label}{x_labels}
</svg>"""


def _build_index(receipts: list[Receipt], out_dir: Path) -> None:
    rows = []
    grand_total = Decimal(0)
    grand_saved = Decimal(0)
    for r in sorted(receipts, key=lambda r: r.purchased_at, reverse=True):
        grand_total += r.total
        grand_saved += _total_saved(r.line_items)
        rows.append(
            f"<tr><td>{_fmt_datetime(r.purchased_at)}</td>"
            f"<td>{_esc(r.store.name)}</td>"
            f'<td class="num">{len(r.line_items)}</td>'
            f'<td class="num">{_fmt_money(r.total, r.currency)}</td>'
            f'<td><a href="receipts/{_esc(r.receipt_id)}.html">Details</a></td></tr>'
        )
    body = f"""<h1>Kaufland Receipts</h1>
<p class="subtitle">{len(receipts)} receipt(s)</p>
<div class="card-grid">
<div class="card"><div class="label">Total saved</div><div class="value">{_fmt_money(grand_saved)}</div></div>
<div class="card"><div class="label">Total spent</div><div class="value">{_fmt_money(grand_total)}</div></div>
</div>
<table>
<thead><tr><th>Date</th><th>Store</th><th class="num">Items</th><th class="num">Total</th><th></th></tr></thead>
<tbody>
{''.join(rows) if rows else '<tr><td colspan="5">No receipts yet.</td></tr>'}
</tbody>
</table>
"""
    (out_dir / "index.html").write_text(_page("Kaufland Receipts", body), encoding="utf-8")


def _build_receipt_pages(receipts: list[Receipt], out_dir: Path) -> None:
    receipts_dir = out_dir / "receipts"
    receipts_dir.mkdir(parents=True, exist_ok=True)
    for r in receipts:
        item_rows = []
        for li in _merge_duplicate_lines(r.line_items):
            item_link = f"items/{_esc(slugify(li.name))}.html"
            unit_cell = f"{li.unit_price:.2f} EUR" if li.unit_price is not None else "&ndash;"
            size_note = (
                f' <span class="badge">{li.size_value.normalize():f} {_esc(li.size_unit)}</span>'
                if li.size_value is not None
                else ""
            )
            item_rows.append(
                f'<tr><td><a href="../{item_link}">{_esc(li.name)}</a>{size_note}</td>'
                f'<td class="num">{li.quantity}</td>'
                f'<td class="num">{unit_cell}</td>'
                f'<td class="num">{li.total_price:.2f} EUR</td>'
                f'<td><span class="badge">{_esc(li.tax_class or "?")}</span></td></tr>'
            )
        reconciled = (
            '<span class="match">&#10003; matches printed total</span>'
            if r.totals_match()
            else f'<span class="mismatch">&#9888; line items sum to {r.line_item_sum():.2f}, '
            f"printed total is {r.total:.2f}</span>"
        )
        address = ", ".join(
            part for part in [r.store.street, f"{r.store.postal_code or ''} {r.store.city or ''}".strip()] if part
        )
        pdf_link = ""
        if r.source_file:
            src_pdf = Path(r.source_file)
            if src_pdf.exists():
                dest_name = f"{r.receipt_id}.pdf"
                shutil.copy2(src_pdf, receipts_dir / dest_name)
                pdf_link = f' <a href="{_esc(dest_name)}">View original PDF</a>'
        body = f"""<a class="back" href="../index.html">&larr; All receipts</a>
<h1>{_esc(r.store.name)}</h1>
<p class="subtitle">{_fmt_datetime(r.purchased_at)}{' &middot; ' + _esc(address) if address else ''}</p>
<p><span class="badge">{_esc(r.receipt_id)}</span> <span class="badge">source: {_esc(r.source)}</span>{pdf_link}</p>
<table>
<thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th><th>Tax</th></tr></thead>
<tbody>
{''.join(item_rows)}
</tbody>
<tfoot>
<tr><td colspan="3">Total saved</td><td class="num">{_fmt_money(_total_saved(r.line_items), r.currency)}</td><td></td></tr>
<tr><td colspan="3">Total</td><td class="num">{_fmt_money(r.total, r.currency)}</td><td></td></tr>
</tfoot>
</table>
<p>{reconciled}</p>
"""
        (receipts_dir / f"{r.receipt_id}.html").write_text(
            _page(f"{r.store.name} — {_fmt_date(r.purchased_at)}", body, prefix="../"), encoding="utf-8"
        )


def _build_item_pages(receipts: list[Receipt], out_dir: Path) -> None:
    items_dir = out_dir / "items"
    items_dir.mkdir(parents=True, exist_ok=True)

    by_name: dict[str, list[tuple[Receipt, LineItem]]] = defaultdict(list)
    for r in receipts:
        for li in _merge_duplicate_lines(r.line_items):
            if li.unit_price is None or li.total_price < 0:
                continue
            by_name[li.name].append((r, li))

    for name, observations in by_name.items():
        observations.sort(key=lambda ro: ro[0].purchased_at)
        points = [(ro[0].purchased_at.date(), ro[1].unit_price) for ro in observations]
        rows = []
        for r, li in reversed(observations):
            rows.append(
                f"<tr><td>{_fmt_date(r.purchased_at)}</td>"
                f'<td><a href="../receipts/{_esc(r.receipt_id)}.html">{_esc(r.receipt_id)}</a></td>'
                f'<td class="num">{li.unit_price:.2f} EUR</td>'
                f'<td class="num">{li.quantity}</td></tr>'
            )
        first_p, last_p = points[0][1], points[-1][1]
        change_note = ""
        if len(points) > 1 and first_p != last_p:
            delta = last_p - first_p
            pct = (delta / first_p * 100) if first_p else Decimal(0)
            direction = "up" if delta > 0 else "down"
            change_note = (
                f'<p class="subtitle">{direction} from {first_p:.2f} to {last_p:.2f} EUR '
                f"({pct:+.1f}%) between {_fmt_date(points[0][0])} and {_fmt_date(points[-1][0])}</p>"
            )
        body = f"""<a class="back" href="../index.html">&larr; All receipts</a>
<h1>{_esc(name)}</h1>
<p class="subtitle">{len(points)} observation(s)</p>
{change_note}
<div class="chart">{_svg_sparkline(points)}</div>
<table>
<thead><tr><th>Date</th><th>Receipt</th><th class="num">Unit price</th><th class="num">Qty</th></tr></thead>
<tbody>
{''.join(rows)}
</tbody>
</table>
"""
        (items_dir / f"{slugify(name)}.html").write_text(
            _page(f"Price history — {name}", body, prefix="../"), encoding="utf-8"
        )


def _build_stats(receipts: list[Receipt], out_dir: Path) -> None:
    by_month: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    counts: dict[str, int] = defaultdict(int)
    for r in receipts:
        key = r.purchased_at.strftime("%Y-%m")
        by_month[key] += r.total
        counts[key] += 1

    now = datetime.now()
    windows = [("Last 30 days", 30), ("Last 6 months", 182), ("Last 12 months", 365)]
    cards = []
    for label, days in windows:
        cutoff = now - timedelta(days=days)
        total = sum((r.total for r in receipts if r.purchased_at >= cutoff), Decimal(0))
        n = sum(1 for r in receipts if r.purchased_at >= cutoff)
        cards.append(
            f'<div class="card"><div class="label">{_esc(label)}</div>'
            f'<div class="value">{total:.2f} EUR</div>'
            f'<div class="label">{n} receipt(s)</div></div>'
        )

    month_rows = []
    for month in sorted(by_month, reverse=True):
        month_rows.append(
            f'<tr><td>{_fmt_month(month)}</td><td class="num">{counts[month]}</td>'
            f'<td class="num">{by_month[month]:.2f} EUR</td></tr>'
        )
    grand = sum(by_month.values(), Decimal(0))

    body = f"""<h1>Statistics</h1>
<p class="subtitle">Trailing spend as of {_fmt_date(now)}</p>
<div class="card-grid">{''.join(cards)}</div>
<h2>Monthly totals</h2>
<table>
<thead><tr><th>Month</th><th class="num">Receipts</th><th class="num">Total</th></tr></thead>
<tbody>
{''.join(month_rows) if month_rows else '<tr><td colspan="3">No receipts yet.</td></tr>'}
</tbody>
<tfoot><tr><td>Total</td><td class="num">{sum(counts.values())}</td><td class="num">{grand:.2f} EUR</td></tr></tfoot>
</table>
"""
    (out_dir / "stats.html").write_text(_page("Statistics", body, active="stats"), encoding="utf-8")


def build_site(receipts: list[Receipt], out_dir: Path) -> None:
    """Regenerate the whole static site from scratch into ``out_dir``."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if (out_dir / "receipts").exists():
        shutil.rmtree(out_dir / "receipts")
    if (out_dir / "items").exists():
        shutil.rmtree(out_dir / "items")
    (out_dir / "style.css").write_text(STYLE_CSS, encoding="utf-8")
    _build_index(receipts, out_dir)
    _build_receipt_pages(receipts, out_dir)
    _build_item_pages(receipts, out_dir)
    _build_stats(receipts, out_dir)
