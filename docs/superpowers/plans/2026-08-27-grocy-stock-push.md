# Grocy Stock Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write parsed receipt line items into a user's own Grocy instance as stock — a one-way push, gated per receipt on every line item having a resolved Product Mapping, with a picker UI to resolve unmapped items and a retry path for partial failures.

**Architecture:** Three new backend modules split by responsibility (mirroring this repo's existing `parse_pdf.py` / `store.py` / `export.py` split): `grocy_store.py` (local persistence — Product Mapping cache, per-line-item push state, Grocy Product Defaults, readiness computation; no network), `grocy_client.py` (thin HTTP wrapper over Grocy's REST API; no local state), and `grocy.py` (orchestration gluing the two together — resolving a mapping and pushing every receipt that becomes ready as a result). `server.py` gains new `/api/grocy/*` endpoints that are thin wiring over `grocy.py`. Two new frontend pages (`GrocyPage.tsx` for the pending-items picker, `GrocySettingsPage.tsx` for Grocy Product Defaults) talk to those endpoints directly — no change to `export_web_data`/`receipts.json`, since push state is local integration state, not receipt content.

**Tech Stack:** Python (pydantic models, httpx for outbound Grocy API calls), existing FastAPI/uvicorn server, React/TypeScript frontend with the existing shadcn `Command` component for the search-as-you-type picker.

**Spec:** `docs/superpowers/specs/2026-08-27-grocy-stock-push-design.md`, `CONTEXT.md` (Grocy Stock Push, Product Mapping, Grocy Product Defaults, Grocy Push Readiness, Grocy Push Attempt terms), `docs/adr/0002-initial-audience-is-selfhosted-ha-niche.md`, `docs/adr/0003-ha-integration-exposes-events-not-raw-data.md`.

## Global Constraints

- Money fields stay `Decimal` throughout the Python side; only converted (to `float`, for JSON transport) at the one boundary that needs it — the outbound Grocy HTTP call in `grocy_client.py`. Never introduce floats anywhere else.
- No automatic unit/size conversion (design Non-goal) — `LineItem.quantity` is pushed to Grocy as-is, trusting it matches whatever purchase unit the mapped Grocy product is configured with.
- `Receipt.threshold_coupon_discount` is never read by any Grocy code — the price pushed is always `total_price / quantity` for the specific line item, full stop (design Non-goal: no coupon proration).
- Grocy integration is optional at runtime: if `GROCY_URL`/`GROCY_API_KEY` are unset, the app must still start and serve every existing feature normally — `/api/grocy/*` endpoints return `503` instead of crashing anything else.
- No test hits the real `https://grocy.example/` instance. `GrocyClient` tests use `httpx.MockTransport`; higher-level tests use a hand-written fake client — matching this project's existing rule against tests depending on external or gitignored resources (see the Price Integrity Check plan's `samples/` rule, same principle).
- No `kaufland grocy` CLI command (design Non-goal) — this entire feature is web-UI-only.
- Frontend `web/` commands need `nvm use system` (not `v20.18.0`) — `package.json`'s `engines` requires Node `^20.19.0 || >=22.12.0` (`nvm use system` resolves to v22.22.3 on this machine, verified in earlier sessions).

---

### Task 1: `grocy_store.py` — Product Mapping cache, push-state, defaults, readiness

**Files:**
- Create: `src/kaufland_receipts/grocy_store.py`
- Create: `tests/test_grocy_store.py`

**Interfaces:**
- Consumes: `LineItem`, `Receipt` (`models.py`), `default_data_dir()` (`store.py`)
- Produces: `class ProductMapping(BaseModel)` (`grocy_product_id: int | None`, `skipped: bool`, `resolved_at: datetime`); `class LineItemPushState(BaseModel)` (`status: str`, `error: str | None`, `pushed_at: datetime | None`); `class GrocyProductDefaults(BaseModel)` (`location_id: int`, `quantity_unit_id: int`); `class GrocyStore` with `all_mappings() -> dict[str, ProductMapping]`, `resolve_mapping(raw_name: str, *, grocy_product_id: int | None, skipped: bool = False) -> ProductMapping`, `get_push_state(receipt_id: str) -> dict[int, LineItemPushState]`, `set_push_state(receipt_id: str, index: int, state: LineItemPushState) -> None`, `get_defaults() -> GrocyProductDefaults | None`, `set_defaults(defaults: GrocyProductDefaults) -> None`; `push_readiness(receipt: Receipt, mappings: dict[str, ProductMapping]) -> bool`

This is pure local persistence — no network, no `GrocyClient` dependency — so it can be fully TDD'd first, same reasoning as why Price Integrity Check's `price_integrity.py` (pure logic) came before its export wiring.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_grocy_store.py`:

```python
"""Tests for local Grocy integration state (see CONTEXT.md's Product Mapping,
Grocy Push Readiness, Grocy Push Attempt, Grocy Product Defaults terms).
Pure filesystem persistence -- no network, no real Grocy instance."""

from datetime import datetime
from decimal import Decimal

from kaufland_receipts.grocy_store import (
    GrocyProductDefaults,
    GrocyStore,
    LineItemPushState,
    ProductMapping,
    push_readiness,
)
from kaufland_receipts.models import LineItem, Receipt, Store


def _receipt(line_names: list[str]) -> Receipt:
    line_items = [
        LineItem(name=name, quantity=Decimal(1), unit_price=Decimal("1.00"),
                  total_price=Decimal("1.00"), tax_class="A")
        for name in line_names
    ]
    return Receipt(
        receipt_id="r1", purchased_at=datetime(2026, 8, 27, 10, 0, 0),
        store=Store(name="Kaufland"), line_items=line_items,
        total=Decimal(len(line_names)),
    )


def test_resolve_and_read_back_a_mapping(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("H-MILCH 3,5%", grocy_product_id=42)

    mappings = gs.all_mappings()

    assert mappings["H-MILCH 3,5%"] == ProductMapping(
        grocy_product_id=42, skipped=False,
        resolved_at=mappings["H-MILCH 3,5%"].resolved_at,
    )
    assert mappings["H-MILCH 3,5%"].grocy_product_id == 42


def test_resolve_a_skip(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("K Card XTRA Rabatt", grocy_product_id=None, skipped=True)

    mapping = gs.all_mappings()["K Card XTRA Rabatt"]

    assert mapping.skipped is True
    assert mapping.grocy_product_id is None


def test_mappings_persist_across_store_instances(tmp_path):
    GrocyStore(data_dir=tmp_path).resolve_mapping("Milch", grocy_product_id=1)

    reloaded = GrocyStore(data_dir=tmp_path)

    assert reloaded.all_mappings()["Milch"].grocy_product_id == 1


def test_push_state_roundtrip(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.set_push_state("r1", 0, LineItemPushState(status="pushed", pushed_at=datetime(2026, 8, 27)))
    gs.set_push_state("r1", 1, LineItemPushState(status="failed", error="connection refused"))

    state = gs.get_push_state("r1")

    assert state[0].status == "pushed"
    assert state[1].status == "failed"
    assert state[1].error == "connection refused"


def test_push_state_is_per_receipt(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.set_push_state("r1", 0, LineItemPushState(status="pushed"))

    assert gs.get_push_state("r2") == {}


def test_defaults_roundtrip(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    assert gs.get_defaults() is None

    gs.set_defaults(GrocyProductDefaults(location_id=3, quantity_unit_id=7))

    assert gs.get_defaults() == GrocyProductDefaults(location_id=3, quantity_unit_id=7)


def test_push_readiness_requires_every_line_item_resolved():
    receipt = _receipt(["Milch", "Brot"])
    mappings = {"Milch": ProductMapping(grocy_product_id=1, resolved_at=datetime(2026, 8, 27))}

    assert push_readiness(receipt, mappings) is False

    mappings["Brot"] = ProductMapping(grocy_product_id=None, skipped=True, resolved_at=datetime(2026, 8, 27))

    assert push_readiness(receipt, mappings) is True


def test_push_readiness_true_for_an_all_skipped_receipt():
    receipt = _receipt(["K Card XTRA Rabatt"])
    mappings = {"K Card XTRA Rabatt": ProductMapping(grocy_product_id=None, skipped=True, resolved_at=datetime(2026, 8, 27))}

    assert push_readiness(receipt, mappings) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_grocy_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaufland_receipts.grocy_store'`

- [ ] **Step 3: Implement the module**

Create `src/kaufland_receipts/grocy_store.py`:

```python
"""Local, offline state for Grocy Stock Push (see CONTEXT.md's Product
Mapping, Grocy Push Readiness, Grocy Push Attempt, Grocy Product Defaults
terms and docs/superpowers/specs/2026-08-27-grocy-stock-push-design.md).

No network calls here -- this only persists our own local decisions and
computes readiness from them. See grocy_client.py for the Grocy API wrapper
and grocy.py for the orchestration that ties the two together.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel

from .models import Receipt
from .store import default_data_dir


class ProductMapping(BaseModel):
    """A resolved Product Mapping: either a Grocy product id, or a skip."""
    grocy_product_id: int | None
    skipped: bool = False
    resolved_at: datetime


class LineItemPushState(BaseModel):
    """A Grocy Push Attempt outcome for one line item on one receipt."""
    status: str  # "pushed" | "failed"
    error: str | None = None
    pushed_at: datetime | None = None


class GrocyProductDefaults(BaseModel):
    """Grocy Product Defaults -- applied to every product created via the
    Product Mapping picker's "create new" path."""
    location_id: int
    quantity_unit_id: int


def _safe_filename(receipt_id: str) -> str:
    # Same sanitization as ReceiptStore._path_for -- receipt_id is used as a
    # filename, keep it filesystem-safe.
    return receipt_id.replace("/", "_").replace(os.sep, "_") + ".json"


class GrocyStore:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or default_data_dir()
        self.grocy_dir = self.data_dir / "grocy"
        self.mappings_path = self.grocy_dir / "mappings.json"
        self.push_state_dir = self.grocy_dir / "push_state"
        self.settings_path = self.grocy_dir / "settings.json"
        self.grocy_dir.mkdir(parents=True, exist_ok=True)
        self.push_state_dir.mkdir(parents=True, exist_ok=True)

    # -- Product Mapping ---------------------------------------------------

    def all_mappings(self) -> dict[str, ProductMapping]:
        if not self.mappings_path.exists():
            return {}
        raw = json.loads(self.mappings_path.read_text("utf-8"))
        return {name: ProductMapping.model_validate(m) for name, m in raw.items()}

    def resolve_mapping(
        self, raw_name: str, *, grocy_product_id: int | None, skipped: bool = False
    ) -> ProductMapping:
        mappings = self.all_mappings()
        mapping = ProductMapping(
            grocy_product_id=grocy_product_id, skipped=skipped, resolved_at=datetime.now()
        )
        mappings[raw_name] = mapping
        self.mappings_path.write_text(
            json.dumps({name: m.model_dump(mode="json") for name, m in mappings.items()}, indent=2),
            encoding="utf-8",
        )
        return mapping

    # -- Grocy Push Attempt --------------------------------------------------

    def get_push_state(self, receipt_id: str) -> dict[int, LineItemPushState]:
        path = self.push_state_dir / _safe_filename(receipt_id)
        if not path.exists():
            return {}
        raw = json.loads(path.read_text("utf-8"))
        return {int(index): LineItemPushState.model_validate(s) for index, s in raw.items()}

    def set_push_state(self, receipt_id: str, index: int, state: LineItemPushState) -> None:
        path = self.push_state_dir / _safe_filename(receipt_id)
        current = self.get_push_state(receipt_id)
        current[index] = state
        path.write_text(
            json.dumps({str(i): s.model_dump(mode="json") for i, s in current.items()}, indent=2),
            encoding="utf-8",
        )

    # -- Grocy Product Defaults ----------------------------------------------

    def get_defaults(self) -> GrocyProductDefaults | None:
        if not self.settings_path.exists():
            return None
        return GrocyProductDefaults.model_validate_json(self.settings_path.read_text("utf-8"))

    def set_defaults(self, defaults: GrocyProductDefaults) -> None:
        self.settings_path.write_text(defaults.model_dump_json(indent=2), encoding="utf-8")


def push_readiness(receipt: Receipt, mappings: dict[str, ProductMapping]) -> bool:
    """Grocy Push Readiness: every line item on the receipt has a resolved
    Product Mapping (matched or skipped) -- see CONTEXT.md."""
    return all(li.name in mappings for li in receipt.line_items)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_grocy_store.py -v`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run the full test suite (regression check)**

Run: `uv run pytest -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/grocy_store.py tests/test_grocy_store.py
git commit -m "feat: add GrocyStore -- local Product Mapping/push-state/defaults persistence"
```

---

### Task 2: `grocy_client.py` — Grocy REST API wrapper

**Files:**
- Create: `src/kaufland_receipts/grocy_client.py`
- Create: `tests/test_grocy_client.py`
- Modify: `pyproject.toml`

**Interfaces:**
- Produces: `class GrocyProduct(BaseModel)` (`id: int`, `name: str`); `class GrocyLocation(BaseModel)` (`id: int`, `name: str`); `class GrocyQuantityUnit(BaseModel)` (`id: int`, `name: str`); `class GrocyClient` with `__init__(self, base_url: str, api_key: str, transport: httpx.BaseTransport | None = None)`, `search_products(query: str) -> list[GrocyProduct]`, `list_locations() -> list[GrocyLocation]`, `list_quantity_units() -> list[GrocyQuantityUnit]`, `create_product(name: str, location_id: int, qu_id_purchase: int, qu_id_stock: int) -> int`, `add_stock(product_id: int, amount: Decimal, price: Decimal, purchased_date: str) -> None`, `check_connection() -> bool`; `GrocyClient.from_env() -> GrocyClient | None` (classmethod)

**Verify before implementing:** the exact Grocy REST API shapes below are recalled from Grocy's general API design (generic `/api/objects/<entity>` CRUD + `/api/stock/products/{id}/add`), not confirmed against a live response. Before writing Step 3's implementation, hit the live instance's interactive API docs to confirm: `curl -s https://grocy.example/api/openapi/specification | head -100` (or open `https://grocy.example/api/` in a browser — Grocy serves a Swagger UI there) and confirm (a) the exact filter-query parameter syntax for `GET /api/objects/products` (assumed below: `query[]=name~<value>` for a case-insensitive contains match), and (b) the exact required fields for `POST /api/objects/products` (assumed below: `name`, `location_id`, `qu_id_purchase`, `qu_id_stock`). Adjust the Step 3 code to match what's actually confirmed; the tests in Step 1 test our own request-building and response-parsing logic against a mocked transport, so they stay valid regardless — only the exact params/fields inside `grocy_client.py` may need correcting.

- [ ] **Step 1: Add `httpx` as a main dependency**

Edit `pyproject.toml` — `httpx` moves from the `dev` group (where it's only used by FastAPI's `TestClient`) into `[project] dependencies`, since `GrocyClient` now calls it at runtime, not just in tests:

```toml
dependencies = [
    "pydantic>=2.13.4",
    "pypdf>=6.16.1",
    "typer>=0.12",
    "fastapi>=0.121",
    "uvicorn[standard]>=0.35",
    "python-multipart>=0.0.20",
    "httpx>=0.28",
]

[project.scripts]
kaufland = "kaufland_receipts.cli:app"
kaufland-receipts = "kaufland_receipts.cli:app"

[build-system]
requires = ["uv_build>=0.12.5,<0.13.0"]
build-backend = "uv_build"

[dependency-groups]
dev = [
    "pytest>=9.1.1",
]
```

Run: `uv sync`

- [ ] **Step 2: Write the failing tests**

Create `tests/test_grocy_client.py`:

```python
"""Tests for the Grocy REST API wrapper (see CONTEXT.md's Grocy Stock Push
term). No real HTTP -- every test runs against httpx.MockTransport, never
the live https://grocy.example/ instance."""

from decimal import Decimal

import httpx
import pytest

from kaufland_receipts.grocy_client import GrocyClient


def _client(handler) -> GrocyClient:
    transport = httpx.MockTransport(handler)
    return GrocyClient(base_url="https://grocy.example", api_key="secret-key", transport=transport)


def test_search_products_sends_the_api_key_header_and_parses_results():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["url"] = str(request.url)
        return httpx.Response(200, json=[{"id": 1, "name": "Milch"}, {"id": 2, "name": "Milchreis"}])

    client = _client(handler)
    results = client.search_products("Milch")

    assert captured["headers"]["GROCY-API-KEY"] == "secret-key"
    assert "objects/products" in captured["url"]
    assert [p.id for p in results] == [1, 2]
    assert results[0].name == "Milch"


def test_list_locations():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"id": 1, "name": "Pantry"}])

    client = _client(handler)
    locations = client.list_locations()

    assert len(locations) == 1
    assert locations[0].id == 1
    assert locations[0].name == "Pantry"


def test_list_quantity_units():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"id": 3, "name": "Stück"}])

    client = _client(handler)
    units = client.list_quantity_units()

    assert units[0].id == 3
    assert units[0].name == "Stück"


def test_create_product_returns_the_new_id():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["body"] = request.read()
        return httpx.Response(200, json={"created_object_id": "17"})

    client = _client(handler)
    new_id = client.create_product(name="H-Milch 3,5%", location_id=1, qu_id_purchase=3, qu_id_stock=3)

    assert captured["method"] == "POST"
    assert new_id == 17


def test_add_stock_posts_to_the_purchase_endpoint():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        return httpx.Response(200, json={})

    client = _client(handler)
    client.add_stock(product_id=17, amount=Decimal("2"), price=Decimal("1.50"), purchased_date="2026-08-27")

    assert captured["method"] == "POST"
    assert "stock/products/17/add" in captured["url"]


def test_add_stock_raises_on_an_error_response():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error_message": "Product not found"})

    client = _client(handler)
    with pytest.raises(httpx.HTTPStatusError):
        client.add_stock(product_id=999, amount=Decimal("1"), price=Decimal("1.00"), purchased_date="2026-08-27")


def test_check_connection_true_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"grocy_version": {"Version": "4.0.0"}})

    assert _client(handler).check_connection() is True


def test_check_connection_false_on_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error_message": "invalid api key"})

    assert _client(handler).check_connection() is False


def test_from_env_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.delenv("GROCY_URL", raising=False)
    monkeypatch.delenv("GROCY_API_KEY", raising=False)

    assert GrocyClient.from_env() is None


def test_from_env_builds_a_client_when_configured(monkeypatch):
    monkeypatch.setenv("GROCY_URL", "https://grocy.example")
    monkeypatch.setenv("GROCY_API_KEY", "secret-key")

    client = GrocyClient.from_env()

    assert client is not None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_grocy_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaufland_receipts.grocy_client'`

- [ ] **Step 4: Implement the module**

Create `src/kaufland_receipts/grocy_client.py`:

```python
"""Thin wrapper over Grocy's REST API (see CONTEXT.md's Grocy Stock Push
term and docs/superpowers/specs/2026-08-27-grocy-stock-push-design.md).

No local state or persistence here -- see grocy_store.py for that, and
grocy.py for the orchestration that combines the two. Auth is a
GROCY-API-KEY header, per Grocy's documented API convention.

The filter syntax used in search_products() and the required fields in
create_product() are recalled from Grocy's general API shape, not
confirmed against a live response -- verify both against the real instance
(https://grocy.example/api/ serves interactive API docs) and adjust if
they don't match.
"""

from __future__ import annotations

import os
from decimal import Decimal

import httpx
from pydantic import BaseModel


class GrocyProduct(BaseModel):
    id: int
    name: str


class GrocyLocation(BaseModel):
    id: int
    name: str


class GrocyQuantityUnit(BaseModel):
    id: int
    name: str


class GrocyClient:
    def __init__(self, base_url: str, api_key: str, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/api/",
            headers={"GROCY-API-KEY": api_key},
            transport=transport,
        )

    @classmethod
    def from_env(cls) -> "GrocyClient | None":
        base_url = os.environ.get("GROCY_URL")
        api_key = os.environ.get("GROCY_API_KEY")
        if not base_url or not api_key:
            return None
        return cls(base_url=base_url, api_key=api_key)

    def search_products(self, query: str) -> list[GrocyProduct]:
        resp = self._client.get("objects/products", params={"query[]": f"name~{query}"})
        resp.raise_for_status()
        return [GrocyProduct(id=p["id"], name=p["name"]) for p in resp.json()]

    def list_locations(self) -> list[GrocyLocation]:
        resp = self._client.get("objects/locations")
        resp.raise_for_status()
        return [GrocyLocation(id=loc["id"], name=loc["name"]) for loc in resp.json()]

    def list_quantity_units(self) -> list[GrocyQuantityUnit]:
        resp = self._client.get("objects/quantity_units")
        resp.raise_for_status()
        return [GrocyQuantityUnit(id=q["id"], name=q["name"]) for q in resp.json()]

    def create_product(self, name: str, location_id: int, qu_id_purchase: int, qu_id_stock: int) -> int:
        resp = self._client.post(
            "objects/products",
            json={
                "name": name,
                "location_id": location_id,
                "qu_id_purchase": qu_id_purchase,
                "qu_id_stock": qu_id_stock,
            },
        )
        resp.raise_for_status()
        return int(resp.json()["created_object_id"])

    def add_stock(self, product_id: int, amount: Decimal, price: Decimal, purchased_date: str) -> None:
        # Decimal isn't JSON-serializable via httpx's json= encoder -- convert
        # to float at this one boundary (see Global Constraints in the plan).
        resp = self._client.post(
            f"stock/products/{product_id}/add",
            json={
                "amount": float(amount),
                "transaction_type": "purchase",
                "price": float(price),
                "purchased_date": purchased_date,
            },
        )
        resp.raise_for_status()

    def check_connection(self) -> bool:
        try:
            resp = self._client.get("system/info")
            resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_grocy_client.py -v`
Expected: PASS (all 10 tests)

- [ ] **Step 6: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Task 1's)

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock src/kaufland_receipts/grocy_client.py tests/test_grocy_client.py
git commit -m "feat: add GrocyClient -- Grocy REST API wrapper"
```

---

### Task 3: `grocy.py` — orchestration (resolve, push, retry)

**Files:**
- Create: `src/kaufland_receipts/grocy.py`
- Create: `tests/test_grocy.py`

**Interfaces:**
- Consumes: `GrocyStore`, `ProductMapping`, `LineItemPushState`, `GrocyProductDefaults`, `push_readiness` (`grocy_store.py`, Task 1); `GrocyClient` (`grocy_client.py`, Task 2, used duck-typed — a hand-written fake with the same method names works fine in tests, no subclassing needed); `Receipt` (`models.py`)
- Produces: `push_receipt(receipt: Receipt, grocy_store: GrocyStore, grocy_client) -> bool` (re-attempts only line items without a successful Grocy Push Attempt; returns `True` iff every mapped, non-skipped item ends up `"pushed"`); `resolve_mapping_and_push(raw_name: str, receipts: list[Receipt], grocy_store: GrocyStore, grocy_client, *, grocy_product_id: int | None, skipped: bool = False) -> list[str]`; `create_product_and_map_and_push(raw_name: str, new_product_name: str, receipts: list[Receipt], grocy_store: GrocyStore, grocy_client) -> list[str]`

A design gap surfaced while writing this task, not covered explicitly during grilling: **Product Mapping is global** (keyed by raw name, not by receipt), so resolving one raw name can bring *multiple* pending receipts to Grocy Push Readiness at once — e.g. a batch of five unsynced receipts all containing `"H-MILCH 3,5%"` for the first time. `resolve_mapping_and_push` therefore checks every receipt containing the resolved name, not just "the" receipt the user happened to be looking at, and pushes each one that becomes ready. This follows directly from Product Mapping's own definition (resolve once, applies everywhere) — there's no reasonable alternative reading.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_grocy.py`:

```python
"""Tests for Grocy push orchestration (see CONTEXT.md's Grocy Push
Readiness and Grocy Push Attempt terms). Uses a hand-written fake
GrocyClient -- never the real one, never a live Grocy instance."""

from datetime import datetime
from decimal import Decimal

from kaufland_receipts.grocy import (
    create_product_and_map_and_push,
    push_receipt,
    resolve_mapping_and_push,
)
from kaufland_receipts.grocy_store import GrocyProductDefaults, GrocyStore
from kaufland_receipts.models import LineItem, Receipt, Store


class _FakeGrocyClient:
    """Records every add_stock call; can be told to fail on specific
    product ids to simulate a partial-failure push."""

    def __init__(self, fail_product_ids: set[int] | None = None):
        self.added: list[tuple[int, Decimal, Decimal, str]] = []
        self.created: list[dict] = []
        self._fail_product_ids = fail_product_ids or set()
        self._next_created_id = 100

    def add_stock(self, product_id, amount, price, purchased_date):
        if product_id in self._fail_product_ids:
            raise RuntimeError(f"Grocy rejected product {product_id}")
        self.added.append((product_id, amount, price, purchased_date))

    def create_product(self, name, location_id, qu_id_purchase, qu_id_stock):
        self.created.append({
            "name": name, "location_id": location_id,
            "qu_id_purchase": qu_id_purchase, "qu_id_stock": qu_id_stock,
        })
        self._next_created_id += 1
        return self._next_created_id


def _line(name, total_price="2.00", quantity="1") -> LineItem:
    return LineItem(
        name=name, quantity=Decimal(quantity), unit_price=Decimal(total_price),
        total_price=Decimal(total_price), tax_class="A",
    )


def _receipt(rid, line_items) -> Receipt:
    total = sum((li.total_price for li in line_items), Decimal(0))
    return Receipt(
        receipt_id=rid, purchased_at=datetime(2026, 8, 27, 10, 0, 0),
        store=Store(name="Kaufland"), line_items=line_items, total=total,
    )


def test_push_receipt_pushes_every_mapped_item(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("Milch", grocy_product_id=1)
    gs.resolve_mapping("Brot", grocy_product_id=2)
    receipt = _receipt("r1", [_line("Milch", total_price="2.00"), _line("Brot", total_price="1.50")])
    client = _FakeGrocyClient()

    ok = push_receipt(receipt, gs, client)

    assert ok is True
    # both lines have quantity=1 (the _line() default), so amount == price
    # numerically here -- see the dedicated quantity-vs-price test below for
    # a case where they're forced to differ, catching an amount/price swap.
    assert (1, Decimal("1"), Decimal("2.00"), "2026-08-27") in client.added
    assert (2, Decimal("1"), Decimal("1.50"), "2026-08-27") in client.added
    state = gs.get_push_state("r1")
    assert state[0].status == "pushed"
    assert state[1].status == "pushed"


def test_push_receipt_pushes_the_receipts_quantity_as_the_amount(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("Milch", grocy_product_id=1)
    receipt = _receipt("r1", [_line("Milch", total_price="3.00", quantity="2")])
    client = _FakeGrocyClient()

    push_receipt(receipt, gs, client)

    # amount is the raw receipt quantity (2); price is per-unit (3.00 / 2 =
    # 1.50) -- these must never be swapped (see CONTEXT.md: no unit
    # conversion, quantity pushed as-is).
    assert client.added == [(1, Decimal("2"), Decimal("1.50"), "2026-08-27")]


def test_push_receipt_skips_skipped_items(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("K Card XTRA Rabatt", grocy_product_id=None, skipped=True)
    receipt = _receipt("r1", [_line("K Card XTRA Rabatt", total_price="-0.30")])
    client = _FakeGrocyClient()

    ok = push_receipt(receipt, gs, client)

    assert ok is True
    assert client.added == []
    assert gs.get_push_state("r1") == {}


def test_push_receipt_records_failure_and_does_not_double_push_on_retry(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("Milch", grocy_product_id=1)
    gs.resolve_mapping("Brot", grocy_product_id=2)
    receipt = _receipt("r1", [_line("Milch"), _line("Brot")])
    client = _FakeGrocyClient(fail_product_ids={2})

    first = push_receipt(receipt, gs, client)
    assert first is False
    assert gs.get_push_state("r1")[0].status == "pushed"
    assert gs.get_push_state("r1")[1].status == "failed"

    client.added.clear()  # simulate Grocy now being reachable again
    second_client = _FakeGrocyClient()
    second = push_receipt(receipt, gs, second_client)

    assert second is True
    # only the previously-failed item (Brot, index 1) is retried -- Milch
    # (index 0) already succeeded and must not be pushed twice. Both lines
    # have quantity=1 (the _line() default), so amount == price == 2.00.
    assert second_client.added == [(2, Decimal("1"), Decimal("2.00"), "2026-08-27")]


def test_resolve_mapping_and_push_pushes_the_single_ready_receipt(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    receipt = _receipt("r1", [_line("Milch")])
    client = _FakeGrocyClient()

    pushed = resolve_mapping_and_push("Milch", [receipt], gs, client, grocy_product_id=1)

    assert pushed == ["r1"]
    assert client.added == [(1, Decimal("1"), Decimal("2.00"), "2026-08-27")]


def test_resolve_mapping_and_push_pushes_every_receipt_that_becomes_ready(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.resolve_mapping("Brot", grocy_product_id=2)  # already resolved on both receipts
    r1 = _receipt("r1", [_line("Milch"), _line("Brot")])
    r2 = _receipt("r2", [_line("Milch")])
    r3 = _receipt("r3", [_line("Milch"), _line("Käse")])  # Käse still unresolved -- not ready
    client = _FakeGrocyClient()

    pushed = resolve_mapping_and_push("Milch", [r1, r2, r3], gs, client, grocy_product_id=1)

    assert set(pushed) == {"r1", "r2"}


def test_resolve_mapping_and_push_does_not_push_a_receipt_still_missing_other_mappings(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    receipt = _receipt("r1", [_line("Milch"), _line("Käse")])
    client = _FakeGrocyClient()

    pushed = resolve_mapping_and_push("Milch", [receipt], gs, client, grocy_product_id=1)

    assert pushed == []
    assert client.added == []


def test_create_product_and_map_and_push_uses_defaults(tmp_path):
    gs = GrocyStore(data_dir=tmp_path)
    gs.set_defaults(GrocyProductDefaults(location_id=1, quantity_unit_id=3))
    receipt = _receipt("r1", [_line("Neues Produkt")])
    client = _FakeGrocyClient()

    pushed = create_product_and_map_and_push("Neues Produkt", "Neues Produkt", [receipt], gs, client)

    assert pushed == ["r1"]
    assert client.created == [{
        "name": "Neues Produkt", "location_id": 1, "qu_id_purchase": 3, "qu_id_stock": 3,
    }]
    assert gs.all_mappings()["Neues Produkt"].grocy_product_id == 101
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_grocy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaufland_receipts.grocy'`

- [ ] **Step 3: Implement the module**

Create `src/kaufland_receipts/grocy.py`:

```python
"""Grocy Stock Push orchestration -- combines grocy_store.py's local state
with grocy_client.py's API calls (see CONTEXT.md's Grocy Stock Push, Grocy
Push Readiness, and Grocy Push Attempt terms, and
docs/superpowers/specs/2026-08-27-grocy-stock-push-design.md).
"""

from __future__ import annotations

from datetime import datetime

from .grocy_store import GrocyStore, LineItemPushState, push_readiness
from .models import Receipt


def push_receipt(receipt: Receipt, grocy_store: GrocyStore, grocy_client) -> bool:
    """Attempts every line item that isn't already a successful Grocy Push
    Attempt -- safe to call repeatedly (a retry) without double-pushing
    stock for items that already succeeded. Skipped mappings are never
    pushed and never recorded as a push attempt. Returns True iff every
    mapped, non-skipped item ends up "pushed"."""
    mappings = grocy_store.all_mappings()
    push_state = grocy_store.get_push_state(receipt.receipt_id)
    all_ok = True
    for index, li in enumerate(receipt.line_items):
        mapping = mappings.get(li.name)
        if mapping is None or mapping.skipped:
            continue
        existing = push_state.get(index)
        if existing is not None and existing.status == "pushed":
            continue
        try:
            grocy_client.add_stock(
                product_id=mapping.grocy_product_id,
                amount=li.quantity,
                price=li.total_price / li.quantity,
                purchased_date=receipt.purchased_at.date().isoformat(),
            )
            grocy_store.set_push_state(
                receipt.receipt_id, index,
                LineItemPushState(status="pushed", pushed_at=datetime.now()),
            )
        except Exception as exc:
            grocy_store.set_push_state(
                receipt.receipt_id, index,
                LineItemPushState(status="failed", error=str(exc)),
            )
            all_ok = False
    return all_ok


def resolve_mapping_and_push(
    raw_name: str,
    receipts: list[Receipt],
    grocy_store: GrocyStore,
    grocy_client,
    *,
    grocy_product_id: int | None,
    skipped: bool = False,
) -> list[str]:
    """Resolves raw_name once, then pushes every receipt containing it that
    has just reached Grocy Push Readiness as a result -- Product Mapping is
    global, so more than one pending receipt can become ready from a single
    resolution. Returns the ids of receipts a push was attempted for
    (whether it fully succeeded or not -- see GrocyStore.get_push_state for
    per-item outcome)."""
    grocy_store.resolve_mapping(raw_name, grocy_product_id=grocy_product_id, skipped=skipped)
    mappings = grocy_store.all_mappings()
    pushed_receipt_ids = []
    for r in receipts:
        if not any(li.name == raw_name for li in r.line_items):
            continue
        if not push_readiness(r, mappings):
            continue
        push_receipt(r, grocy_store, grocy_client)
        pushed_receipt_ids.append(r.receipt_id)
    return pushed_receipt_ids


def create_product_and_map_and_push(
    raw_name: str,
    new_product_name: str,
    receipts: list[Receipt],
    grocy_store: GrocyStore,
    grocy_client,
) -> list[str]:
    """The picker's "create new" path: creates the product in Grocy using
    Grocy Product Defaults, then behaves exactly like
    resolve_mapping_and_push with the newly created product id."""
    defaults = grocy_store.get_defaults()
    if defaults is None:
        raise ValueError("Grocy Product Defaults are not configured yet.")
    product_id = grocy_client.create_product(
        name=new_product_name,
        location_id=defaults.location_id,
        qu_id_purchase=defaults.quantity_unit_id,
        qu_id_stock=defaults.quantity_unit_id,
    )
    return resolve_mapping_and_push(
        raw_name, receipts, grocy_store, grocy_client, grocy_product_id=product_id,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_grocy.py -v`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Tasks 1-2's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/grocy.py tests/test_grocy.py
git commit -m "feat: add Grocy push orchestration (resolve, push, retry)"
```

---

### Task 4: `/api/grocy/*` FastAPI endpoints

**Files:**
- Modify: `src/kaufland_receipts/server.py`
- Modify: `tests/test_server.py`

**Interfaces:**
- Consumes: `GrocyStore`, `push_readiness` (`grocy_store.py`); `GrocyClient` (`grocy_client.py`); `push_receipt`, `resolve_mapping_and_push`, `create_product_and_map_and_push` (`grocy.py`)
- Produces: `create_app(store: ReceiptStore, web_dir: Path, grocy_store: GrocyStore | None = None, grocy_client: GrocyClient | None = None) -> FastAPI` (signature change — two new optional params, existing two-arg call sites keep working unchanged); `GET /api/grocy/pending`, `GET /api/grocy/search?q=`, `POST /api/grocy/mappings`, `POST /api/grocy/receipts/{receipt_id}/retry`, `GET /api/grocy/settings`, `PUT /api/grocy/settings`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_server.py` (add these imports at the top: `from kaufland_receipts.grocy_client import GrocyLocation, GrocyProduct, GrocyQuantityUnit`, `from kaufland_receipts.grocy_store import GrocyProductDefaults, GrocyStore`; reuse the file's existing `Receipt`, `Store`, `LineItem`, `Decimal`, `datetime` imports):

```python
class _FakeGrocyClient:
    def __init__(self, *, connected=True, fail_product_ids=None):
        self.connected = connected
        self.added = []
        self.created = []
        self._fail_product_ids = fail_product_ids or set()
        self._next_id = 200

    def search_products(self, query):
        return [GrocyProduct(id=1, name="Milch")] if query else []

    def list_locations(self):
        return [GrocyLocation(id=1, name="Pantry")]

    def list_quantity_units(self):
        return [GrocyQuantityUnit(id=3, name="Stück")]

    def create_product(self, name, location_id, qu_id_purchase, qu_id_stock):
        self.created.append(name)
        self._next_id += 1
        return self._next_id

    def add_stock(self, product_id, amount, price, purchased_date):
        if product_id in self._fail_product_ids:
            raise RuntimeError("Grocy unreachable")
        self.added.append(product_id)

    def check_connection(self):
        return self.connected


def _grocy_client_app(tmp_path, *, grocy_client=None):
    store = ReceiptStore(data_dir=tmp_path / "data")
    grocy_store = GrocyStore(data_dir=tmp_path / "data")
    app = create_app(store, web_dir=tmp_path / "web", grocy_store=grocy_store, grocy_client=grocy_client)
    return TestClient(app), store, grocy_store


def _receipt_with_one_item(rid="r1", name="Milch") -> Receipt:
    li = LineItem(name=name, quantity=Decimal(1), unit_price=Decimal("2.00"),
                  total_price=Decimal("2.00"), tax_class="A")
    return Receipt(receipt_id=rid, purchased_at=datetime(2026, 8, 27, 10, 0, 0),
                    store=Store(name="Kaufland"), line_items=[li], total=Decimal("2.00"))


def test_grocy_endpoints_503_when_not_configured(tmp_path, monkeypatch):
    monkeypatch.delenv("GROCY_URL", raising=False)
    monkeypatch.delenv("GROCY_API_KEY", raising=False)
    client, store, _gs = _grocy_client_app(tmp_path)
    store.save(_receipt_with_one_item())

    assert client.get("/api/grocy/search", params={"q": "Milch"}).status_code == 503
    assert client.post("/api/grocy/mappings", json={"raw_name": "Milch", "grocy_product_id": 1}).status_code == 503
    assert client.post("/api/grocy/receipts/r1/retry").status_code == 503


def test_grocy_pending_lists_receipts_with_unresolved_items(tmp_path):
    client, store, _gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())
    store.save(_receipt_with_one_item("r1", "Milch"))

    res = client.get("/api/grocy/pending")

    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["receipt_id"] == "r1"
    assert body[0]["unresolved"] == [{"index": 0, "name": "Milch"}]
    assert body[0]["failed"] == []


def test_grocy_pending_omits_a_fully_resolved_receipt(tmp_path):
    client, store, gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())
    store.save(_receipt_with_one_item("r1", "Milch"))
    gs.resolve_mapping("Milch", grocy_product_id=1)

    assert client.get("/api/grocy/pending").json() == []


def test_grocy_search_proxies_to_the_client(tmp_path):
    client, _store, _gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())

    res = client.get("/api/grocy/search", params={"q": "Milch"})

    assert res.status_code == 200
    assert res.json() == [{"id": 1, "name": "Milch"}]


def test_grocy_resolve_mapping_pushes_the_ready_receipt(tmp_path):
    fake = _FakeGrocyClient()
    client, store, gs = _grocy_client_app(tmp_path, grocy_client=fake)
    store.save(_receipt_with_one_item("r1", "Milch"))

    res = client.post("/api/grocy/mappings", json={"raw_name": "Milch", "grocy_product_id": 1})

    assert res.status_code == 200
    assert res.json() == {"pushed_receipt_ids": ["r1"]}
    assert gs.get_push_state("r1")[0].status == "pushed"


def test_grocy_resolve_mapping_with_a_new_product_name_creates_it(tmp_path):
    fake = _FakeGrocyClient()
    client, store, gs = _grocy_client_app(tmp_path, grocy_client=fake)
    gs.set_defaults(GrocyProductDefaults(location_id=1, quantity_unit_id=3))
    store.save(_receipt_with_one_item("r1", "Neues Produkt"))

    res = client.post("/api/grocy/mappings", json={"raw_name": "Neues Produkt", "new_product_name": "Neues Produkt"})

    assert res.status_code == 200
    assert fake.created == ["Neues Produkt"]
    assert res.json()["pushed_receipt_ids"] == ["r1"]


def test_grocy_resolve_mapping_skip(tmp_path):
    client, store, gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())
    store.save(_receipt_with_one_item("r1", "K Card XTRA Rabatt"))

    res = client.post("/api/grocy/mappings", json={"raw_name": "K Card XTRA Rabatt", "skipped": True})

    assert res.status_code == 200
    assert res.json() == {"pushed_receipt_ids": ["r1"]}
    assert gs.all_mappings()["K Card XTRA Rabatt"].skipped is True


def test_grocy_retry_only_reattempts_failed_items(tmp_path):
    fake = _FakeGrocyClient(fail_product_ids={1})
    client, store, gs = _grocy_client_app(tmp_path, grocy_client=fake)
    store.save(_receipt_with_one_item("r1", "Milch"))
    client.post("/api/grocy/mappings", json={"raw_name": "Milch", "grocy_product_id": 1})
    assert gs.get_push_state("r1")[0].status == "failed"

    fake._fail_product_ids = set()  # Grocy reachable again
    res = client.post("/api/grocy/receipts/r1/retry")

    assert res.status_code == 200
    assert res.json() == {"all_pushed": True}
    assert gs.get_push_state("r1")[0].status == "pushed"


def test_grocy_retry_404s_for_an_unknown_receipt(tmp_path):
    client, _store, _gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())

    assert client.post("/api/grocy/receipts/does-not-exist/retry").status_code == 404


def test_grocy_settings_get_reports_connection_and_choices(tmp_path):
    client, _store, _gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient(connected=True))

    res = client.get("/api/grocy/settings")

    assert res.status_code == 200
    body = res.json()
    assert body["connected"] is True
    assert body["defaults"] is None
    assert body["locations"] == [{"id": 1, "name": "Pantry"}]
    assert body["quantity_units"] == [{"id": 3, "name": "Stück"}]


def test_grocy_settings_put_persists_defaults(tmp_path):
    client, _store, gs = _grocy_client_app(tmp_path, grocy_client=_FakeGrocyClient())

    res = client.put("/api/grocy/settings", json={"location_id": 1, "quantity_unit_id": 3})

    assert res.status_code == 200
    assert gs.get_defaults() == GrocyProductDefaults(location_id=1, quantity_unit_id=3)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_server.py -v`
Expected: FAIL — `404`/`TypeError` on the new tests, since none of these routes or the new `create_app` params exist yet.

- [ ] **Step 3: Implement the endpoints**

In `src/kaufland_receipts/server.py`, add to the imports:

```python
from pydantic import BaseModel

from .grocy import create_product_and_map_and_push, push_receipt, resolve_mapping_and_push
from .grocy_client import GrocyClient
from .grocy_store import GrocyProductDefaults, GrocyStore, push_readiness
```

Change the `create_app` signature and add the Grocy setup right after the existing `uploads_dir = store.data_dir / "uploads"` line:

```python
def create_app(
    store: ReceiptStore,
    web_dir: Path,
    grocy_store: GrocyStore | None = None,
    grocy_client: GrocyClient | None = None,
) -> FastAPI:
    app = FastAPI()
    uploads_dir = store.data_dir / "uploads"
    grocy_store = grocy_store or GrocyStore(data_dir=store.data_dir)
    if grocy_client is None:
        grocy_client = GrocyClient.from_env()
```

Add a small request model near the top of the file (after the imports, before `create_app`):

```python
class _MappingResolution(BaseModel):
    raw_name: str
    grocy_product_id: int | None = None
    new_product_name: str | None = None
    skipped: bool = False
```

Add the new routes inside `create_app`, after the existing `/api/upload` route and before the `public_dir = web_dir / "public"` static-mount block:

```python
    def _require_grocy() -> None:
        if grocy_client is None:
            raise HTTPException(503, detail="Grocy not configured (set GROCY_URL and GROCY_API_KEY).")

    @app.get("/api/grocy/pending")
    def grocy_pending() -> list[dict]:
        mappings = grocy_store.all_mappings()
        result = []
        for r in store.all():
            push_state = grocy_store.get_push_state(r.receipt_id)
            unresolved = [
                {"index": i, "name": li.name}
                for i, li in enumerate(r.line_items)
                if li.name not in mappings
            ]
            failed = [
                {"index": i, "name": r.line_items[i].name, "error": s.error}
                for i, s in push_state.items()
                if s.status == "failed"
            ]
            if unresolved or failed:
                result.append({
                    "receipt_id": r.receipt_id,
                    "purchased_at": r.purchased_at.isoformat(),
                    "store_name": r.store.name,
                    "total": str(r.total),
                    "currency": r.currency,
                    "unresolved": unresolved,
                    "failed": failed,
                })
        return result

    @app.get("/api/grocy/search")
    def grocy_search(q: str) -> list[dict]:
        _require_grocy()
        return [p.model_dump() for p in grocy_client.search_products(q)]

    @app.post("/api/grocy/mappings")
    def grocy_resolve_mapping(body: _MappingResolution) -> dict:
        _require_grocy()
        receipts = store.all()
        if body.new_product_name:
            pushed = create_product_and_map_and_push(
                body.raw_name, body.new_product_name, receipts, grocy_store, grocy_client,
            )
        else:
            pushed = resolve_mapping_and_push(
                body.raw_name, receipts, grocy_store, grocy_client,
                grocy_product_id=body.grocy_product_id, skipped=body.skipped,
            )
        return {"pushed_receipt_ids": pushed}

    @app.post("/api/grocy/receipts/{receipt_id}/retry")
    def grocy_retry(receipt_id: str) -> dict:
        _require_grocy()
        if not store.has(receipt_id):
            raise HTTPException(404, detail="Receipt not found.")
        receipt = store.load(receipt_id)
        all_ok = push_receipt(receipt, grocy_store, grocy_client)
        return {"all_pushed": all_ok}

    @app.get("/api/grocy/settings")
    def grocy_get_settings() -> dict:
        defaults = grocy_store.get_defaults()
        connected = grocy_client is not None and grocy_client.check_connection()
        locations = grocy_client.list_locations() if grocy_client else []
        quantity_units = grocy_client.list_quantity_units() if grocy_client else []
        return {
            "connected": connected,
            "defaults": defaults.model_dump() if defaults else None,
            "locations": [loc.model_dump() for loc in locations],
            "quantity_units": [q.model_dump() for q in quantity_units],
        }

    @app.put("/api/grocy/settings")
    def grocy_put_settings(body: GrocyProductDefaults) -> dict:
        grocy_store.set_defaults(body)
        return {"status": "ok"}
```

Note: `grocy_pending` deliberately does **not** call `_require_grocy()` — the pending list (which items need mapping) is meaningful even before Grocy is configured, since Product Mapping resolution and picking are separate from whether a push can actually run; only actions that need to *talk to* Grocy (`search`, resolving with a real product id, retry) require it. (Resolving with `skipped=True` when Grocy isn't configured would currently still 503 via `grocy_resolve_mapping`'s blanket `_require_grocy()` — acceptable for this MVP; not worth special-casing skip-only resolution against an unconfigured Grocy.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS (all tests, including the pre-existing upload ones)

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS (all tests, including Tasks 1-3's)

- [ ] **Step 6: Commit**

```bash
git add src/kaufland_receipts/server.py tests/test_server.py
git commit -m "feat: add /api/grocy/* endpoints"
```

---

### Task 5: `GrocyPage` — pending items picker, route, nav tab

**Files:**
- Modify: `web/src/lib/types.ts`
- Create: `web/src/lib/grocy.ts`
- Create: `web/src/pages/GrocyPage.tsx`
- Create: `web/src/pages/GrocyPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `GET /api/grocy/pending`, `GET /api/grocy/search?q=`, `POST /api/grocy/mappings`, `POST /api/grocy/receipts/{id}/retry` (Task 4)
- Produces: `GrocyPendingReceipt`, `GrocyProduct` types (`types.ts`); `fetchPending`, `searchGrocyProducts`, `resolveMapping`, `retryReceiptPush` (`grocy.ts`); `export function GrocyPage()`, route `/grocy`

- [ ] **Step 1: Add the TypeScript types**

In `web/src/lib/types.ts`, add at the end of the file:

```ts
export interface GrocyProduct {
  id: number
  name: string
}

export interface GrocyPendingItem {
  index: number
  name: string
}

export interface GrocyFailedItem {
  index: number
  name: string
  error: string | null
}

export interface GrocyPendingReceipt {
  receipt_id: string
  purchased_at: string
  store_name: string
  total: string
  currency: string
  unresolved: GrocyPendingItem[]
  failed: GrocyFailedItem[]
}
```

- [ ] **Step 2: Write the failing tests for the `grocy.ts` fetch helpers**

Create `web/src/lib/grocy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPending, resolveMapping, retryReceiptPush, searchGrocyProducts } from "@/lib/grocy"

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("grocy.ts fetch helpers", () => {
  it("fetchPending calls GET /api/grocy/pending", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] })
    await fetchPending()
    expect(fetch).toHaveBeenCalledWith("/api/grocy/pending")
  })

  it("searchGrocyProducts encodes the query", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] })
    await searchGrocyProducts("H-Milch 3,5%")
    expect(fetch).toHaveBeenCalledWith("/api/grocy/search?q=H-Milch%203%2C5%25")
  })

  it("resolveMapping POSTs the resolution", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ pushed_receipt_ids: ["r1"] }),
    })
    const result = await resolveMapping({ raw_name: "Milch", grocy_product_id: 1 })
    expect(fetch).toHaveBeenCalledWith(
      "/api/grocy/mappings",
      expect.objectContaining({ method: "POST" }),
    )
    expect(result.pushed_receipt_ids).toEqual(["r1"])
  })

  it("retryReceiptPush POSTs to the receipt's retry endpoint", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ all_pushed: true }) })
    await retryReceiptPush("r1")
    expect(fetch).toHaveBeenCalledWith("/api/grocy/receipts/r1/retry", expect.objectContaining({ method: "POST" }))
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/grocy.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/grocy"`

- [ ] **Step 4: Implement `grocy.ts`**

Create `web/src/lib/grocy.ts`:

```ts
import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

export async function fetchPending(): Promise<GrocyPendingReceipt[]> {
  const res = await fetch("/api/grocy/pending")
  if (!res.ok) throw new Error("Could not load pending Grocy items.")
  return res.json()
}

export async function searchGrocyProducts(query: string): Promise<GrocyProduct[]> {
  const res = await fetch(`/api/grocy/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error("Could not search Grocy products.")
  return res.json()
}

export async function resolveMapping(params: {
  raw_name: string
  grocy_product_id?: number
  new_product_name?: string
  skipped?: boolean
}): Promise<{ pushed_receipt_ids: string[] }> {
  const res = await fetch("/api/grocy/mappings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error("Could not resolve the mapping.")
  return res.json()
}

export async function retryReceiptPush(receiptId: string): Promise<{ all_pushed: boolean }> {
  const res = await fetch(`/api/grocy/receipts/${receiptId}/retry`, { method: "POST" })
  if (!res.ok) throw new Error("Retry failed.")
  return res.json()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/grocy.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Write the failing tests for `GrocyPage`**

Create `web/src/pages/GrocyPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GrocyPage } from "./GrocyPage"
import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

afterEach(cleanup)

function pending(overrides: Partial<GrocyPendingReceipt> = {}): GrocyPendingReceipt {
  return {
    receipt_id: "r1",
    purchased_at: "2026-08-27T10:00:00",
    store_name: "Kaufland",
    total: "2.00",
    currency: "EUR",
    unresolved: [{ index: 0, name: "Milch" }],
    failed: [],
    ...overrides,
  }
}

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`
      const body = routes[key]
      if (body === undefined) throw new Error(`Unmocked fetch: ${key}`)
      return Promise.resolve({ ok: true, json: async () => body })
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("GrocyPage", () => {
  it("lists an unresolved item for a pending receipt", async () => {
    mockFetch({ "GET /api/grocy/pending": [pending()] })
    render(<GrocyPage />)

    await waitFor(() => expect(screen.getByText("Milch")).toBeInTheDocument())
    expect(screen.getByText(/Kaufland/)).toBeInTheDocument()
  })

  it("resolves an item by picking a search result", async () => {
    const searchResult: GrocyProduct[] = [{ id: 1, name: "H-Milch" }]
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "GET /api/grocy/search": searchResult,
      "POST /api/grocy/mappings": { pushed_receipt_ids: ["r1"] },
    })
    render(<GrocyPage />)
    await waitFor(() => expect(screen.getByText("Milch")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /map "milch"/i }))
    fireEvent.change(screen.getByPlaceholderText(/search grocy products/i), { target: { value: "Milch" } })
    await waitFor(() => expect(screen.getByText("H-Milch")).toBeInTheDocument())
    fireEvent.click(screen.getByText("H-Milch"))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/mappings",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ raw_name: "Milch", grocy_product_id: 1 }),
        }),
      ),
    )
  })

  it("resolves an item as skipped", async () => {
    mockFetch({
      "GET /api/grocy/pending": [pending()],
      "POST /api/grocy/mappings": { pushed_receipt_ids: ["r1"] },
    })
    render(<GrocyPage />)
    await waitFor(() => expect(screen.getByText("Milch")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /skip "milch"/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/mappings",
        expect.objectContaining({
          body: JSON.stringify({ raw_name: "Milch", skipped: true }),
        }),
      ),
    )
  })

  it("shows a retry button for a failed item and calls the retry endpoint", async () => {
    mockFetch({
      "GET /api/grocy/pending": [
        pending({ unresolved: [], failed: [{ index: 0, name: "Milch", error: "Grocy unreachable" }] }),
      ],
      "POST /api/grocy/receipts/r1/retry": { all_pushed: true },
    })
    render(<GrocyPage />)

    await waitFor(() => expect(screen.getByText(/grocy unreachable/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /retry/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/grocy/receipts/r1/retry", expect.objectContaining({ method: "POST" })),
    )
  })
})
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/pages/GrocyPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./GrocyPage"`

- [ ] **Step 8: Implement `GrocyPage.tsx`**

Create `web/src/pages/GrocyPage.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { fetchPending, resolveMapping, retryReceiptPush, searchGrocyProducts } from "@/lib/grocy"
import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"

function ItemPicker({
  rawName,
  onResolved,
}: {
  rawName: string
  onResolved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GrocyProduct[]>([])

  useEffect(() => {
    if (!open || !query) {
      setResults([])
      return
    }
    let cancelled = false
    searchGrocyProducts(query).then((r) => {
      if (!cancelled) setResults(r)
    })
    return () => {
      cancelled = true
    }
  }, [open, query])

  async function pick(product: GrocyProduct) {
    await resolveMapping({ raw_name: rawName, grocy_product_id: product.id })
    setOpen(false)
    onResolved()
  }

  async function createNew() {
    if (!query) return
    await resolveMapping({ raw_name: rawName, new_product_name: query })
    setOpen(false)
    onResolved()
  }

  async function skip() {
    await resolveMapping({ raw_name: rawName, skipped: true })
    onResolved()
  }

  return (
    <div className="flex items-center gap-2">
      <span>{rawName}</span>
      {open ? (
        <Command className="w-72 rounded border border-border">
          <CommandInput
            placeholder="Search Grocy products..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length === 0) createNew()
            }}
          />
          <CommandList>
            <CommandEmpty>
              <button type="button" className="w-full px-2 py-1 text-left text-sm" onClick={createNew}>
                Create "{query}"
              </button>
            </CommandEmpty>
            <CommandGroup>
              {results.map((p) => (
                <CommandItem key={p.id} value={p.name} onSelect={() => pick(p)}>
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : (
        <Button size="sm" variant="secondary" aria-label={`Map "${rawName}"`} onClick={() => setOpen(true)}>
          Map
        </Button>
      )}
      <Button size="sm" variant="ghost" aria-label={`Skip "${rawName}"`} onClick={skip}>
        Skip
      </Button>
    </div>
  )
}

export function GrocyPage() {
  const [pending, setPending] = useState<GrocyPendingReceipt[]>([])

  async function reload() {
    setPending(await fetchPending())
  }

  useEffect(() => {
    reload()
  }, [])

  async function retry(receiptId: string) {
    await retryReceiptPush(receiptId)
    reload()
  }

  return (
    <div className="flex flex-col gap-4">
      {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
      {pending.map((r) => (
        <Card key={r.receipt_id}>
          <CardHeader>
            <CardTitle>
              {r.store_name} &middot; {r.total} {r.currency}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {r.unresolved.map((item) => (
              <ItemPicker key={item.index} rawName={item.name} onResolved={reload} />
            ))}
            {r.failed.map((item) => (
              <div key={item.index} className="flex items-center gap-2">
                <span>{item.name}</span>
                <Badge variant="destructive">{item.error}</Badge>
                <Button size="sm" variant="secondary" onClick={() => retry(r.receipt_id)}>
                  Retry
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/GrocyPage.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 10: Wire the route and nav tab**

In `web/src/App.tsx`, add the lazy import alongside the others:

```tsx
const GrocyPage = lazy(() => import("@/pages/GrocyPage").then((m) => ({ default: m.GrocyPage })))
```

Add the route inside `<Route element={<Layout />}>`:

```tsx
<Route path="grocy" element={<GrocyPage />} />
```

In `web/src/components/Layout.tsx`, add to `TABS`:

```tsx
const TABS = [
  { to: "/", label: "Receipts", end: true },
  { to: "/upload", label: "Upload", end: false },
  { to: "/grocy", label: "Grocy", end: false },
  { to: "/stats", label: "Statistics", end: false },
]
```

- [ ] **Step 11: Run the full frontend suite and lint**

Run: `cd web && npm test && npm run lint`
Expected: PASS, no new lint errors

- [ ] **Step 12: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/grocy.ts web/src/lib/grocy.test.ts web/src/pages/GrocyPage.tsx web/src/pages/GrocyPage.test.tsx web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add GrocyPage -- Product Mapping picker and retry UI"
```

---

### Task 6: `GrocySettingsPage` — Grocy Product Defaults

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/grocy.ts`
- Modify: `web/src/lib/grocy.test.ts`
- Create: `web/src/pages/GrocySettingsPage.tsx`
- Create: `web/src/pages/GrocySettingsPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/GrocyPage.tsx`

**Interfaces:**
- Consumes: `GET /api/grocy/settings`, `PUT /api/grocy/settings` (Task 4)
- Produces: `GrocyLocation`, `GrocyQuantityUnit`, `GrocySettings` types (`types.ts`); `fetchGrocySettings`, `saveGrocyDefaults` (`grocy.ts`); `export function GrocySettingsPage()`, route `/grocy/settings`

Resolves the design's open item on where the settings screen lives: its own route (`/grocy/settings`), reachable via a link from `GrocyPage`, but deliberately **not** added to the main `Layout` nav — it's a rarely-visited configuration screen, not a primary destination, so cluttering the top-level nav with it would work against the nav's own purpose (quick access to the pages used every session).

- [ ] **Step 1: Add the TypeScript types**

In `web/src/lib/types.ts`, add at the end of the file:

```ts
export interface GrocyLocation {
  id: number
  name: string
}

export interface GrocyQuantityUnit {
  id: number
  name: string
}

export interface GrocyProductDefaults {
  location_id: number
  quantity_unit_id: number
}

export interface GrocySettings {
  connected: boolean
  defaults: GrocyProductDefaults | null
  locations: GrocyLocation[]
  quantity_units: GrocyQuantityUnit[]
}
```

- [ ] **Step 2: Write the failing tests for the new fetch helpers**

In `web/src/lib/grocy.test.ts`, add `fetchGrocySettings, saveGrocyDefaults` to the existing top-of-file import from `@/lib/grocy`:

```ts
import { fetchPending, fetchGrocySettings, resolveMapping, retryReceiptPush, saveGrocyDefaults, searchGrocyProducts } from "@/lib/grocy"
```

Then append this new `describe` block to the end of the file:

```ts
describe("grocy.ts settings helpers", () => {
  it("fetchGrocySettings calls GET /api/grocy/settings", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true, defaults: null, locations: [], quantity_units: [] }),
    })
    await fetchGrocySettings()
    expect(fetch).toHaveBeenCalledWith("/api/grocy/settings")
  })

  it("saveGrocyDefaults PUTs the chosen defaults", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) })
    await saveGrocyDefaults({ location_id: 1, quantity_unit_id: 3 })
    expect(fetch).toHaveBeenCalledWith(
      "/api/grocy/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ location_id: 1, quantity_unit_id: 3 }),
      }),
    )
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/grocy.test.ts`
Expected: FAIL — `fetchGrocySettings is not exported`

- [ ] **Step 4: Implement the new fetch helpers**

In `web/src/lib/grocy.ts`, add to the imports:

```ts
import type { GrocyPendingReceipt, GrocyProduct, GrocyProductDefaults, GrocySettings } from "@/lib/types"
```

(Replaces the existing `import type { GrocyPendingReceipt, GrocyProduct } from "@/lib/types"` line.)

Append:

```ts
export async function fetchGrocySettings(): Promise<GrocySettings> {
  const res = await fetch("/api/grocy/settings")
  if (!res.ok) throw new Error("Could not load Grocy settings.")
  return res.json()
}

export async function saveGrocyDefaults(defaults: GrocyProductDefaults): Promise<void> {
  const res = await fetch("/api/grocy/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(defaults),
  })
  if (!res.ok) throw new Error("Could not save Grocy settings.")
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/grocy.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Write the failing tests for `GrocySettingsPage`**

Create `web/src/pages/GrocySettingsPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GrocySettingsPage } from "./GrocySettingsPage"

afterEach(cleanup)

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`
      const body = routes[key]
      if (body === undefined) throw new Error(`Unmocked fetch: ${key}`)
      return Promise.resolve({ ok: true, json: async () => body })
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("GrocySettingsPage", () => {
  it("shows a not-connected message when Grocy isn't reachable", async () => {
    mockFetch({
      "GET /api/grocy/settings": { connected: false, defaults: null, locations: [], quantity_units: [] },
    })
    render(<GrocySettingsPage />)

    await waitFor(() => expect(screen.getByText(/not connected/i)).toBeInTheDocument())
  })

  it("saves the selected location and quantity unit", async () => {
    mockFetch({
      "GET /api/grocy/settings": {
        connected: true,
        defaults: null,
        locations: [{ id: 1, name: "Pantry" }],
        quantity_units: [{ id: 3, name: "Stück" }],
      },
      "PUT /api/grocy/settings": { status: "ok" },
    })
    render(<GrocySettingsPage />)
    await waitFor(() => expect(screen.getByText("Pantry")).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/default location/i), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText(/default quantity unit/i), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/grocy/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ location_id: 1, quantity_unit_id: 3 }),
        }),
      ),
    )
  })
})
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/pages/GrocySettingsPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./GrocySettingsPage"`

- [ ] **Step 8: Implement `GrocySettingsPage.tsx`**

Create `web/src/pages/GrocySettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchGrocySettings, saveGrocyDefaults } from "@/lib/grocy"
import type { GrocySettings } from "@/lib/types"

export function GrocySettingsPage() {
  const [settings, setSettings] = useState<GrocySettings | null>(null)
  const [locationId, setLocationId] = useState<number | null>(null)
  const [quantityUnitId, setQuantityUnitId] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchGrocySettings().then((s) => {
      setSettings(s)
      setLocationId(s.defaults?.location_id ?? s.locations[0]?.id ?? null)
      setQuantityUnitId(s.defaults?.quantity_unit_id ?? s.quantity_units[0]?.id ?? null)
    })
  }, [])

  if (!settings) return null

  async function save() {
    if (locationId === null || quantityUnitId === null) return
    await saveGrocyDefaults({ location_id: locationId, quantity_unit_id: quantityUnitId })
    setSaved(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grocy settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!settings.connected && (
          <p className="text-sm text-destructive">Not connected to Grocy — check GROCY_URL and GROCY_API_KEY.</p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Default location
          <select
            value={locationId ?? ""}
            onChange={(e) => setLocationId(Number(e.target.value))}
          >
            {settings.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Default quantity unit
          <select
            value={quantityUnitId ?? ""}
            onChange={(e) => setQuantityUnitId(Number(e.target.value))}
          >
            {settings.quantity_units.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={save}>Save</Button>
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/GrocySettingsPage.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 10: Wire the route and a link from `GrocyPage`**

In `web/src/App.tsx`, add the lazy import:

```tsx
const GrocySettingsPage = lazy(() => import("@/pages/GrocySettingsPage").then((m) => ({ default: m.GrocySettingsPage })))
```

Add the route inside `<Route element={<Layout />}>` (not added to `Layout.tsx`'s `TABS` — see the task intro for why):

```tsx
<Route path="grocy/settings" element={<GrocySettingsPage />} />
```

In `web/src/pages/GrocyPage.tsx`, add the import:

```tsx
import { Link } from "react-router-dom"
```

Add a settings link at the top of the returned JSX, before the `{pending.length === 0 && ...}` line:

```tsx
      <Link to="/grocy/settings" className="self-end text-sm text-muted-foreground hover:text-foreground">
        Grocy settings
      </Link>
```

(This one line goes inside the existing `<div className="flex flex-col gap-4">` wrapper, as its first child.)

- [ ] **Step 11: Run the full frontend suite and lint**

Run: `cd web && npm test && npm run lint`
Expected: PASS, no new lint errors

- [ ] **Step 12: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/grocy.ts web/src/lib/grocy.test.ts web/src/pages/GrocySettingsPage.tsx web/src/pages/GrocySettingsPage.test.tsx web/src/pages/GrocyPage.tsx web/src/App.tsx
git commit -m "feat: add GrocySettingsPage -- Grocy Product Defaults"
```

---

### Task 7: README — document the skip-and-cache behavior, split the Status checklist

**Files:**
- Modify: `README.md`

No code changes, no tests — this is the documentation debt flagged during design (see `docs/superpowers/specs/2026-08-27-grocy-stock-push-design.md`'s Documentation Updates section): explain that discount/Pfand lines aren't auto-detected, and correct the Status checklist, which currently bundles Grocy and HA into one unshipped line even though they're separate features (per `CONTEXT.md` and ADR 0003).

- [ ] **Step 1: Add a Grocy Stock Push section**

In `README.md`, add a new section after the existing "## Site (shadcn/React)" section and before "## Status":

```markdown
## Grocy Stock Push

Set `GROCY_URL` and `GROCY_API_KEY` (a Grocy API key, generated in Grocy's
own settings) as environment variables before running `kaufland serve` /
`docker compose up`, then visit the **Grocy** tab in the web UI.

Every receipt line item needs a one-time **Product Mapping** before it can
be pushed to Grocy's stock: pick a matching Grocy product, type a new name
to create one, or **skip** it. Skipping is permanent and remembered by the
item's exact printed name — so lines that never belong in Grocy stock
(loyalty discounts like "K Card XTRA Rabatt", Pfand/Leergut deposit
returns, one-off non-food purchases) only ever need skipping once; the
same line on every future receipt is skipped automatically from then on.
A receipt only pushes to Grocy once every one of its line items has been
resolved this way.

Visit **Grocy → Grocy settings** first to pick a default location and
quantity unit — used for every product created via the "create new" path,
since Grocy requires both to exist and typing them by hand every time
would defeat the point of a fast "type a name, press enter" flow.
```

- [ ] **Step 2: Split the Status checklist item**

In `README.md`'s `## Status` section, replace:

```markdown
- [ ] Home Assistant (MQTT) + Grocy stock sync
```

with:

```markdown
- [x] Grocy Stock Push — one-way write to Grocy's stock, gated on a
      one-time Product Mapping per line item (web UI only, no CLI)
- [ ] Home Assistant (MQTT) Notification Hook — separate from Grocy Stock
      Push (see `CONTEXT.md`); not yet built
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Grocy Stock Push setup and skip-and-cache behavior"
```
