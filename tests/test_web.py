"""Tests for the static-site SVG chart, which has no PDF/network dependency."""

from datetime import date
from decimal import Decimal

from kaufland_receipts.web import _svg_sparkline


def test_single_point_shows_date_once():
    # The date also appears once more inside the point's <title> tooltip;
    # y="172" (height - 8, default height=180) picks out just the x-axis
    # label(s) at the bottom of the chart.
    svg = _svg_sparkline([(date(2026, 8, 14), Decimal("2.99"))])
    assert svg.count('y="172"') == 1
    assert "2026-08-14</text>" in svg
    assert svg.count("<circle") == 1


def test_multi_point_shows_start_and_end_dates():
    points = [
        (date(2026, 6, 22), Decimal("1.99")),
        (date(2026, 8, 21), Decimal("2.19")),
    ]
    svg = _svg_sparkline(points)
    assert svg.count('y="172"') == 2
    assert "2026-06-22</text>" in svg
    assert "2026-08-21</text>" in svg
