# Initial audience is the self-hosted/home-automation niche, not general consumers

**Status:** accepted

We decided the initial target audience for the **Self-Hosted Distribution** MVP is the self-hosted/home-automation community (r/selfhosted, r/homeassistant, r/grocy) rather than general Kaufland shoppers. This audience already runs Docker-based NAS setups, already trusts self-hosted tools with sensitive-ish personal data, and already has a stated need for grocery/spend tracking (it's why Grocy exists) — making it a sharper, more reachable wedge for validating whether **Price Integrity Check** and **Total Spend Aggregation** are worth anything to anyone besides the author.

This choice drives two concrete build priorities ahead of further parser work:

1. **Docker packaging** — this audience evaluates tools by whether there's a container image they can pull into their NAS's Docker UI (Synology/Unraid/TrueNAS/CasaOS/etc.); an `npm install` / `uv run` developer workflow is a hard adoption wall for most of them.
2. **Grocy/Home Assistant integration** — for this audience, feeding an existing Grocy/HA stock-tracking setup is the actual hook; Price Integrity Check alone is a nice-to-have to them, not the reason they'd install it.

## Consequences

- Rewe/Edeka/Lidl multi-retailer parsing (see `CONTEXT.md`'s **Total Spend Aggregation**) is not the next priority — Docker packaging and Grocy/HA integration are, since they're what make the Kaufland-only MVP appealing to the chosen validation audience.
- Renaming the project (currently `kaufland-receipts`) is deferred until this audience bet is validated — see the project's open renaming question.
- Revisit this decision if outreach to these communities doesn't produce real installs/usage — the audience bet itself would need reconsidering, not just the packaging/integration work.
