"""Tests for the Web Upload HTTP endpoint (see CONTEXT.md's Web Upload)."""

from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient

from kaufland_receipts.models import Receipt, Store
from kaufland_receipts.server import create_app
from kaufland_receipts.store import ReceiptStore


def _client(tmp_path):
    store = ReceiptStore(data_dir=tmp_path / "data")
    app = create_app(store, web_dir=tmp_path / "web")
    return TestClient(app), store


def test_health_check(tmp_path):
    client, _store = _client(tmp_path)

    res = client.get("/api/health")

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def _install_fake_parse_pdf(monkeypatch, *, receipt_id="r1", total="12.34", raises=None):
    """Stand in for the real parse_pdf: mirrors its contract of setting
    source_file to the path it was given, without touching a real PDF."""

    def fake_parse_pdf(path):
        if raises is not None:
            raise raises
        return Receipt(
            receipt_id=receipt_id,
            purchased_at=datetime(2026, 8, 21, 23, 39, 39),
            store=Store(name="Kaufland"),
            line_items=[],
            total=Decimal(total),
            source_file=str(path),
        )

    monkeypatch.setattr("kaufland_receipts.server.parse_pdf", fake_parse_pdf)


def test_upload_adds_a_new_receipt(tmp_path, monkeypatch):
    client, store = _client(tmp_path)
    _install_fake_parse_pdf(monkeypatch, receipt_id="r1", total="12.34")

    res = client.post(
        "/api/upload", files={"file": ("receipt.pdf", b"fake pdf bytes", "application/pdf")}
    )

    assert res.status_code == 200
    assert res.json() == {"status": "added", "receipt_id": "r1", "total": "12.34", "currency": "EUR"}
    assert len(store.all()) == 1


def test_upload_is_idempotent(tmp_path, monkeypatch):
    client, store = _client(tmp_path)
    _install_fake_parse_pdf(monkeypatch, receipt_id="r1", total="12.34")
    client.post("/api/upload", files={"file": ("receipt.pdf", b"fake pdf bytes", "application/pdf")})

    res = client.post(
        "/api/upload", files={"file": ("receipt.pdf", b"fake pdf bytes 2", "application/pdf")}
    )

    assert res.status_code == 200
    assert res.json() == {"status": "duplicate", "receipt_id": "r1"}
    assert len(store.all()) == 1


def test_upload_rejects_a_non_pdf(tmp_path):
    client, store = _client(tmp_path)

    res = client.post(
        "/api/upload", files={"file": ("receipt.txt", b"not a pdf", "text/plain")}
    )

    assert res.status_code == 422
    assert store.all() == []


def test_upload_reports_a_parse_failure(tmp_path, monkeypatch):
    client, store = _client(tmp_path)
    _install_fake_parse_pdf(monkeypatch, raises=ValueError("not a Kaufland receipt"))

    res = client.post(
        "/api/upload", files={"file": ("receipt.pdf", b"fake pdf bytes", "application/pdf")}
    )

    assert res.status_code == 422
    assert res.json() == {"detail": "not a Kaufland receipt"}
    assert store.all() == []
