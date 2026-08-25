# Open-core split: AGPL client, closed-source crowd-data backend

**Status:** accepted

We decided to publish the entire current repo (the self-hosted client — parsing, **Analytics Surface**, **Grocy Stock Push**, **HA Notification Hook**) as open source under AGPL, and to build any future **Cross-Retailer Price Comparison** / **Sale Timing Prediction** backend as a separate, never-published repository once monetization starts.

We considered whether the license itself (AGPL vs MIT) could protect the future business from competitors, and concluded it can't: no open-source license, copyleft or permissive, stops someone from cloning the public repo and running it as a competing paid service — AGPL only requires them to publish their own modifications, not pay or credit the original author. The actual moat is what's never published, not the license terms on what is. Since nothing in the current MVP scope needs protecting (ADR 0003 already keeps raw price-history data out of the HA integration), publishing the whole client costs nothing. The future crowd-data backend is architecturally a separate service anyway — it needs centralized cross-user data the client structurally can't have — so the open/closed boundary already falls naturally between "current repo" and "future repo," with no in-repo edition-splitting needed.

AGPL was chosen over MIT for the client specifically because, as sole copyright holder, dual licensing remains available (selling a proprietary license to parties who don't want AGPL's obligations) and because it keeps community modifications flowing back — not because it blocks competition, which no license can do.

## Consequences

- The future crowd-data backend must never be merged into the public repo — it lives in a separate, private repository from day one, even during early development.
- Revisit if a compelling reason emerges to protect something in the current client's scope (e.g. if Analytics Surface logic itself becomes valuable enough to warrant closing it) — right now nothing in MVP scope needs that.
