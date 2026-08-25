"""HTTP server exposing receipt ingestion over the network.

Backs the Web Upload ingestion path (see CONTEXT.md): unlike Folder Watch,
which only works on a Mac with iCloud Drive, this lets any browser --
Docker/NAS deployments included -- drop a receipt PDF in and have it parsed
and stored.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from .parse_pdf import parse_pdf
from .store import ReceiptStore


def create_app(store: ReceiptStore, web_dir: Path) -> FastAPI:
    app = FastAPI()
    uploads_dir = store.data_dir / "uploads"

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/upload")
    async def upload(file: UploadFile = File(...)) -> dict[str, str]:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(422, detail="Only PDF files are supported.")

        # Persisted under a unique name (not the original filename) so two
        # uploads that happen to share a name never collide; parse_pdf reads
        # from this final path, so `Receipt.source_file` points here for
        # good, matching what export_web_b_data expects downstream.
        uploads_dir.mkdir(parents=True, exist_ok=True)
        dest = uploads_dir / f"{uuid.uuid4().hex[:8]}-{Path(file.filename).name}"
        dest.write_bytes(await file.read())

        try:
            receipt = parse_pdf(dest)
        except Exception as exc:
            raise HTTPException(422, detail=str(exc)) from exc

        if not store.save(receipt):
            return {"status": "duplicate", "receipt_id": receipt.receipt_id}

        return {
            "status": "added",
            "receipt_id": receipt.receipt_id,
            "total": str(receipt.total),
            "currency": receipt.currency,
        }

    return app
