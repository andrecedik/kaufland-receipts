# Docker Packaging — Design

**Status:** approved, ready for implementation planning

## Goal

Let a self-hosted/NAS user (Synology, Unraid, TrueNAS, CasaOS — the audience named in `docs/adr/0002-initial-audience-is-selfhosted-ha-niche.md`) pull one container image, mount one folder for persistent data, and get a working browser UI — without running `npm`/`uv` themselves. This is the next planned subsystem after Web Upload (`docs/adr/0002`'s stated priority), and depends on it being done, which it is.

## Non-goals

- No registry publishing or CI pipeline yet — local `docker build`/`buildx` only, with the exact commands documented. Easy to add once the Dockerfile itself is proven.
- No authentication on `POST /api/upload` — unchanged from Web Upload's existing posture (loopback-safe default, documented caveat about `--host 0.0.0.0`). Not in scope here.
- No nginx / reverse proxy / split-container architecture — single container, single process (see Decisions).

## Decisions

- **Multi-arch:** build for both `linux/amd64` and `linux/arm64` via `docker buildx`, from day one.
- **Publishing:** local-only for now — a documented `buildx build --platform linux/amd64,linux/arm64` command, no registry push, no CI.
- **Process shape:** single container, single process. `kaufland serve` serves both the API (`/api/*`) and the static frontend (`/`) from the same `create_app`. Rejected: nginx-fronted split (two containers) — solves a scaling/separation-of-concerns problem this single-user personal tool doesn't have, and directly contradicts the audience's stated preference for "pull an image, mount a folder, done."
- **Volume mount:** one host folder → `/data` in the container. `ReceiptStore` already honors `XDG_DATA_HOME` (`store.py:22`) with zero code change needed — the image just sets `ENV XDG_DATA_HOME=/data`. This single mount covers both `receipts/` and `uploads/` (both live under the same `data_dir` today), matching the explicit ask from the original grilling session: uploaded receipts accessible from outside the container.
- **`docker-compose.yml`:** included, at the repo root, alongside the `Dockerfile`. Declares the port mapping and volume mount so `docker compose up -d` is the whole story — matches the format self-hosted NAS Docker UIs (Portainer, Synology Container Manager, Unraid) expect or can import.
- **Static-serving trick:** the Docker build's frontend output is copied into `<image>/web/public/` (not into its own separate directory) — because `export_web_b_data(receipts, web_dir)` already writes to `web_dir/public/data/receipts.json` and `web_dir/public/pdfs/`, matching what Vite's dev server already serves from `web/public/` today. Landing the built assets in the *same* directory that function already writes to means **`export_web_b_data` needs zero modification** — it already produces exactly the layout a static-file server needs, whether the caller is `kaufland web-b-data` (dev) or `kaufland serve` (container).
- **Restart behavior:** `kaufland serve` re-exports (`export_web_b_data(store.all(), web_dir)`) once at startup, before binding the port — otherwise a container restart would show stale/empty data (the build-time snapshot) in the browser until the next upload, even though the mounted `/data` volume still has everything. This call is added to the `serve` CLI command itself, not to `create_app`, keeping `create_app` a side-effect-free factory.

## Architecture

Multi-stage `Dockerfile`, one final image:

1. **Build stage** (`node:22-slim`): `npm ci && npm run build` in `web/` → produces `site/` (per the just-completed `site-b/` → `site/` rename).
2. **Runtime stage** (`python:3.12-slim` + `uv`): `uv sync --no-dev` installs the Python package; the build stage's `site/` output is copied into this stage's `web/public/` (flattening — `site/`'s root becomes `web/public/`'s root, since Vite already flattened `web/public/`'s original contents into `site/`'s root at build time; copying it back into `web/public/` restores that same layout one level up).
3. **Runtime:** `ENV XDG_DATA_HOME=/data`; `CMD ["kaufland", "serve", "--web-dir", "web", "--host", "0.0.0.0"]`; `HEALTHCHECK` hitting `GET /api/health`.

**Code change required (`src/kaufland_receipts/server.py`):** `create_app` gains a static-files mount — `(web_dir / "public").mkdir(parents=True, exist_ok=True)` followed by mounting that directory at `/` with `html=True` (serves `index.html` for `GET /`), registered *after* the `/api/health` and `/api/upload` routes so those keep routing priority over the catch-all mount. The frontend's `HashRouter` (chosen specifically to avoid needing server-side route rewrites — see `web/src/App.tsx`'s comment) means no further routing logic is needed; a plain static mount is sufficient for every client-side route.

**Code change required (`src/kaufland_receipts/cli.py`):** the `serve` command calls `export_mod.export_web_b_data(store.all(), web_dir)` once, before `uvicorn.run(...)`.

## Data Flow

- **Build time:** image gets a build-time snapshot of `web/public/` — `index.html` + JS/CSS bundles, plus whatever `data/receipts.json` and `pdfs/` happened to exist on the machine running `docker build` (normally none, for a from-scratch build).
- **Container start:** `serve`'s startup re-export overwrites `web/public/data/receipts.json` / `pdfs/` with whatever is in the mounted `/data` volume's store — so the served state matches reality immediately, not just after the first upload.
- **Runtime, upload:** `POST /api/upload` → parse → store (under `/data`, via `XDG_DATA_HOME`) → `export_web_b_data` (existing code, unchanged) → next browser refresh shows it. Identical mechanism to today's dev-mode Web Upload flow; the only difference is what's on disk being served (the container's `web/public/`, seeded from `/data`, instead of the dev tree's `web/public/`).

## Components

- **`Dockerfile`** (repo root) — as described in Architecture.
- **`docker-compose.yml`** (repo root):
  ```yaml
  services:
    kaufland-receipts:
      build: .
      ports:
        - "8000:8000"
      volumes:
        - ./data:/data   # replace ./data with wherever you want receipts stored on the host
      restart: unless-stopped
  ```
  (Exact image/tag reference to be finalized in the implementation plan once the Dockerfile exists to reference.)
- **`.dockerignore`** (repo root) — excludes `.venv/`, `web/node_modules/`, `site/`, `.worktrees/`, `.git/`, `docs/`, and anything under a local `~/.local/share/kaufland-receipts`-style path if one happens to sit inside the build context, so personal receipt data can never accidentally land in an image layer.

## Verification

No unit-test surface for Docker infrastructure itself (same category as the Web Upload plan's Vite-proxy task). Manual smoke-test, to be scripted as exact commands in the implementation plan:

1. `docker buildx build --platform linux/amd64,linux/arm64 -t kaufland-receipts .` (or a single-platform build for local smoke-testing, since multi-arch output can't run directly on the build machine without emulation).
2. Run the image with a temp volume: `docker run -p 8000:8000 -v $(mktemp -d):/data kaufland-receipts`.
3. `curl http://localhost:8000/api/health` → `{"status":"ok"}`.
4. `curl http://localhost:8000/` → HTML containing the app's root element.
5. Upload a real sample receipt via `curl -F "file=@..."` to `/api/upload`.
6. `curl http://localhost:8000/data/receipts.json` (or reload the browser UI) → confirms the upload is reflected.
7. Restart the container (same volume) → step 4/6 again, confirming the startup re-export makes existing data visible without a fresh upload.

## Open items for the implementation plan

- Exact `.dockerignore` contents (draft above, to be finalized against the real repo tree).
- Exact Dockerfile stage syntax / uv installation method inside the Python stage (e.g. `COPY --from=ghcr.io/astral-sh/uv` vs `pip install uv`).
- Image name/tag convention for the `docker-compose.yml` `build:` vs `image:` field.
