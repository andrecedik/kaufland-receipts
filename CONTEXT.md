# Kaufland Receipts — Price Intelligence

A personal tool that parses your own grocery digital receipts into structured spend and price-history data, with an eventual (deferred) ambition to compare prices across retailers and locations using crowd-contributed data.

## Language

**Price Integrity Check**:
Comparing a product's current effective price (after any attached discount) against the median of the user's own prior purchases of that item at the same store, to flag whether an advertised sale is a genuine reduction. Uses only the user's own historical data — no other users' data required. Not shrinkflation detection: most Kaufland-printed item names carry no pack-size information, and when a size is embedded in a name and changes, the name string itself changes — so there's no reliable signal in this data source to catch a same-name-smaller-pack case.
_Avoid_: Price trends, bargain detection, shrinkflation detection

**Total Spend Aggregation**:
A user's own spend rolled up across every retailer they shop at and have parsed receipts for. Still single-user scope — only the user's own receipts, never another user's.
_Avoid_: Spend analytics

**Cross-Retailer Price Comparison**:
Comparing prices for the same product across different stores, locations, or chains, using receipt data contributed by many users. Has a cold-start problem — the data has no value until many users across many locations contribute — so it's deferred until the single-user features (Price Integrity Check, Total Spend Aggregation) are validated as something people want.
_Avoid_: Price comparison, SaaS (when used to mean this specific feature)

**Self-Hosted Distribution**:
The MVP delivery model — users install and run the tool against their own receipts; nothing is uploaded to infrastructure the project operates. Chosen over a hosted multi-tenant service to avoid data-processor/GDPR obligations and retailer-ToS exposure before Cross-Retailer Price Comparison's business case is proven.
_Avoid_: SaaS

**Monetization Path**:
How the project eventually charges — deferred decision among a paid feature-gated tier, voluntary user sponsorship, or licensing aggregated data to companies. The data-licensing option is not independently available: it requires Cross-Retailer Price Comparison's crowd data to exist first, unlike the other two paths. Gating the *existing* local features (Price Integrity Check, Total Spend Aggregation) behind payment is a weak version of this path, since a free self-hosted alternative already gives that away — Sale Timing Prediction is the current best candidate for a feature-gated tier that offers genuinely new value instead.
_Avoid_: Pricing model, business model

**Stock Depletion Prediction** (future, not in MVP):
Predicting when a user is about to run low on a tracked item, based on their own Grocy Stock Push history. Single-user scope like Price Integrity Check — no crowd data required, so unlike Sale Timing Prediction it doesn't depend on Cross-Retailer Price Comparison existing first.
_Avoid_: predictive analytics, forecasting

**Sale Timing Prediction** (future, not in MVP):
Predicting when a retailer is likely to next discount a given product, based on historical sale-cycle patterns. Needs more data density than Cross-Retailer Price Comparison (pattern detection over time, not just a current-price snapshot), so it's strictly downstream of Feature 2, not a shortcut around its cold-start problem.
_Avoid_: sale forecasting, price prediction

**Open-Core Split**:
The public repo (self-hosted client: parsing, Analytics Surface, Grocy Stock Push, HA Notification Hook) is published under AGPL. Any future crowd-data backend (powering Cross-Retailer Price Comparison, Sale Timing Prediction) is built as a separate, never-published repository once monetization starts. See `docs/adr/0004-open-core-split.md`.
_Avoid_: Open source (ambiguous about scope), SaaS repo (implies it already exists)

**Initial Target Audience**:
The self-hosted/home-automation community (r/selfhosted, r/homeassistant, r/grocy) chosen for validating Price Integrity Check and Total Spend Aggregation, instead of general Kaufland shoppers. See `docs/adr/0002-initial-audience-is-selfhosted-ha-niche.md`.
_Avoid_: Users, customers (when the self-hosted/HA-specific audience is meant)

**Folder Watch**:
The Mac-native ingestion path — `kaufland watch` polls a local iCloud Drive folder for new receipt PDFs. Depends on macOS/iCloud filesystem integration; not available in the Docker/NAS context.
_Avoid_: Watcher, ingestion (when a specific mechanism is meant)

**Web Upload**:
The Docker/NAS-native ingestion path — selecting one or more receipt PDFs into the web UI's file picker. Chosen as the primary ingestion mechanism for the Initial Target Audience because it works identically regardless of host OS/NAS platform, unlike Folder Watch. PDF-only, matching Folder Watch and `parse_pdf`; PNG was an earlier aspiration never built and is not currently planned.
_Avoid_: Upload feature

**Analytics Surface**:
The web UI is the exclusive place price-history, spend trend charts, and Price Integrity Check verdicts are viewable. Kept exclusive so a future Monetization Path (paid tier) isn't trivially bypassed by reading the same data for free elsewhere.
_Avoid_: Dashboard, UI (when the exclusivity is the point)

**HA Notification Hook**:
The Home Assistant integration surface — publishes computed events (e.g. "genuine discount detected on tracked item") for HA users to build notifications/automations on. Deliberately does not expose the underlying price-history data itself, keeping that on the Analytics Surface only.
_Avoid_: HA integration, HA sensors (when raw-data-export is implied)

**Grocy Stock Push**:
A one-way write of parsed receipt line items into Grocy's stock/inventory via Grocy's API. In MVP scope, Kaufland-only initially — unlike Cross-Retailer Price Comparison, it needs no new parsers or crowd data, just an API call using data already parsed today.
_Avoid_: Grocy integration, Grocy sync (implies two-way)
