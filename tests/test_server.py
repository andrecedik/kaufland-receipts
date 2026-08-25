"""Tests for the Web Upload HTTP endpoint (see CONTEXT.md's Web Upload)."""

from pathlib import Path

from fastapi.testclient import TestClient

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


SAMPLE_PDF = Path(__file__).parent.parent / "samples" / "20260821_233939.pdf"


def test_upload_adds_a_new_receipt(tmp_path):
    client, store = _client(tmp_path)

    with SAMPLE_PDF.open("rb") as f:
        res = client.post(
            "/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")}
        )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "added"
    assert body["receipt_id"]
    assert len(store.all()) == 1


def test_upload_is_idempotent(tmp_path):
    client, store = _client(tmp_path)
    with SAMPLE_PDF.open("rb") as f:
        client.post("/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")})

    with SAMPLE_PDF.open("rb") as f:
        res = client.post(
            "/api/upload", files={"file": (SAMPLE_PDF.name, f, "application/pdf")}
        )

    assert res.status_code == 200
    assert res.json()["status"] == "duplicate"
    assert len(store.all()) == 1


def test_upload_rejects_a_non_pdf(tmp_path):
    client, store = _client(tmp_path)

    res = client.post(
        "/api/upload", files={"file": ("receipt.txt", b"not a pdf", "text/plain")}
    )

    assert res.status_code == 422
    assert store.all() == []


def test_upload_reports_a_parse_failure(tmp_path):
    client, store = _client(tmp_path)

    res = client.post(
        "/api/upload",
        files={"file": ("receipt.pdf", b"%PDF-1.4 not really a receipt", "application/pdf")},
    )

    assert res.status_code == 422
    assert store.all() == []
