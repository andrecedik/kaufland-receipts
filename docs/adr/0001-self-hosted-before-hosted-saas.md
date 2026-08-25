# Self-hosted distribution before hosted SaaS

**Status:** accepted

The original business idea was a hosted SaaS. We decided to ship a **Self-Hosted Distribution** MVP instead — covering **Price Integrity Check** and **Total Spend Aggregation**, both single-user-scope features that never require another user's data — and to defer any hosted/multi-tenant service.

We chose this because every hosted option (SaaS, or the hybrid local-processing-with-cloud-sync variant) makes the project a data processor for other people's grocery-spend data before it's validated that anyone wants the product at all, and because the feature that would actually justify hosting — **Cross-Retailer Price Comparison** — has a cold-start problem of its own (the crowd data has no value until many users across many locations contribute) that's independent of the hosting question. Building hosting infrastructure now would be solving a problem (multi-tenancy, GDPR data-processor obligations, retailer-ToS exposure) that the MVP doesn't have yet.

## Considered Options

- **Hosted SaaS** — highest ceiling, but requires solving Cross-Retailer Price Comparison's cold-start problem and takes on data-processor liability immediately, before demand is proven.
- **Hybrid (local processing + optional cloud sync)** — still takes on data-processor liability for the synced data, without solving the cold-start problem either.
- **Self-hosted software** *(chosen)* — reuses the existing local-first architecture, zero data-processor liability, cheapest path to test whether Price Integrity Check / Total Spend Aggregation are worth paying for at all.

## Consequences

- **Monetization Path** is constrained until this is revisited: feature-gating and user sponsorship are available now; licensing aggregated data to companies is not, since it depends on Cross-Retailer Price Comparison existing.
- Revisit this decision once Price Integrity Check / Total Spend Aggregation have validated user demand, or once there's a concrete plan to solve Cross-Retailer Price Comparison's cold-start problem.
