"""Tests for the static-site SVG chart and date formatting, which have no
PDF/network dependency."""

from datetime import date, datetime
from decimal import Decimal

from kaufland_receipts.web import _fmt_date, _fmt_datetime, _fmt_month, _svg_sparkline


def test_dates_are_human_not_iso():
    assert _fmt_date(date(2026, 8, 21)) == "21 Aug 2026"
    assert _fmt_datetime(datetime(2026, 8, 21, 21, 3)) == "21 Aug 2026, 21:03"
    assert _fmt_month("2026-08") == "August 2026"


def test_single_point_shows_date_once():
    # The date also appears once more inside the point's <title> tooltip;
    # y="172" (height - 8, default height=180) picks out just the x-axis
    # label(s) at the bottom of the chart.
    svg = _svg_sparkline([(date(2026, 8, 14), Decimal("2.99"))])
    assert svg.count('y="172"') == 1
    assert "14 Aug 2026</text>" in svg
    assert svg.count("<circle") == 1


def test_multi_point_shows_start_and_end_dates():
    points = [
        (date(2026, 6, 22), Decimal("1.99")),
        (date(2026, 8, 21), Decimal("2.19")),
    ]
    svg = _svg_sparkline(points)
    assert svg.count('y="172"') == 2
    assert "22 Jun 2026</text>" in svg
    assert "21 Aug 2026</text>" in svg
