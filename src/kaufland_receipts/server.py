"""HTTP server exposing receipt ingestion over the network.

Backs the Web Upload ingestion path (see CONTEXT.md): unlike Folder Watch,
which only works on a Mac with iCloud Drive, this lets any browser --
Docker/NAS deployments included -- drop a receipt PDF in and have it parsed
and stored.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from .store import ReceiptStore


def create_app(store: ReceiptStore, web_dir: Path) -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
