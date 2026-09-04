# Public distribution via a GitHub mirror + GHCR, GitLab stays the dev remote

**Status:** accepted

`docs/adr/0004-open-core-split.md` already committed to publishing the client as open-source AGPL, but the repo has only ever lived on a private self-hosted GitLab instance (`gitlab.example`) — nothing made it actually reachable by the r/selfhosted/r/grocy launch audience, and no registry/CI existed to turn commits into a pullable image (deferred explicitly in `docs/superpowers/specs/2026-08-25-docker-packaging-design.md`).

We decided: **GitLab remains the primary dev remote** (day-to-day work, MRs, unchanged workflow) and **push-mirrors automatically to a public GitHub repo** on every push. **GitHub Actions** (not GitLab CI) runs the pipeline against the mirrored `main`, using the zero-config `GITHUB_TOKEN` to push multi-arch images to **GHCR** (not Docker Hub) as `latest` + `sha-<short-sha>` — no semver tags yet, no PR-based external contribution flow yet. `docker-compose.yml`'s default now references the published GHCR image directly (`image: ghcr.io/...`), with a separate dev override compose file for building locally, so the audience's stated preference ("pull an image, mount a folder, done") is the actual default experience, not just a documented alternative to cloning-and-building.

## Considered Options

- **Docker Hub instead of/alongside GHCR** — more recognized pull-count badge in the self-hosted community, but a separate account/secret to manage vs. GHCR's zero-config `GITHUB_TOKEN`; rejected for MVP, can add later if launch feedback asks for it.
- **Flip GitHub to canonical, demote GitLab to a backup mirror** — would have cleanly solved the "external PRs on GitHub don't flow back to GitLab" problem, but throws away the existing GitLab-based dev workflow before there's any evidence of contributor demand; rejected.
- **Semver-tagged releases only** — more standard for a self-hosted project's `docker-compose.yml` example, but the project has zero versioning discipline today (no git tags, no changelog) and launch is imminent; rejected for now, additive to introduce later.
- **All CI in GitLab CI**, pushing to GHCR via a stored GitHub PAT — keeps CI on already-used infrastructure, but spends a secret to avoid using GitHub Actions' free minutes for public repos; rejected.
- **Single CI trigger (main-only)**, no PR/branch test gate — simpler pipeline, but loses fast feedback on a branch before it reaches `main`; rejected, kept the two-trigger split (PR/branch: test+lint+build-sanity; main: test+build+push).

## Consequences

- External contributions are unresolved by design: a GitHub PR against the mirror doesn't flow back to GitLab. Deferred until a real PR shows up — until then, only a README/CONTRIBUTING note that PRs may be manually re-applied on the GitLab side.
- An AGPL-3.0 `LICENSE` file must exist in the repo before the mirror goes public — ADR 0004 decided the license, but the file itself was never added.
- Pull-count (the chosen MVP success metric per ADR 0002) will be read from GHCR's package page, not Docker Hub's more prominent public badge.
- Revisit registry choice, tagging scheme, and the contribution workflow once real launch feedback exists.
