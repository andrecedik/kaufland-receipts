"""Shared fixtures for server tests."""

from datetime import datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from kaufland_receipts.models import Receipt


@pytest.fixture(autouse=True)
def mock_parse_pdf(monkeypatch):
    """Mock parse_pdf to return a test receipt or raise on malformed content.

    This allows tests to work without requiring actual PDF sample files,
    which are in .gitignore (real personal receipt data).
    """
    test_receipt = Receipt(
        receipt_id="test-receipt-001",
        purchased_at=datetime(2026, 8, 21, 23, 39, 39),
        total=Decimal("42.50"),
        currency="EUR",
        source="pdf",
        source_file=None,
    )

    def fake_parse_pdf(pdf_path: Path) -> Receipt:
        # Detect malformed PDFs by checking file size and content
        content = Path(pdf_path).read_bytes()
        # Malformed PDFs (test content) are very small and lack proper structure
        if len(content) < 100:
            raise ValueError(f"Malformed PDF: {pdf_path}")

        # Update source_file to match the path that was passed
        receipt = test_receipt.model_copy()
        receipt.source_file = str(pdf_path)
        return receipt

    monkeypatch.setattr("kaufland_receipts.server.parse_pdf", fake_parse_pdf)
