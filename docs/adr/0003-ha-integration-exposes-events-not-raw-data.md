# HA integration exposes computed events, not raw price data

**Status:** accepted

The **HA Notification Hook** publishes computed events (e.g. "genuine discount detected on tracked item") for Home Assistant users to build notifications and automations on. It deliberately does not expose the underlying price-history time series as generic sensors.

We considered pushing raw price data to HA so users could build their own dashboards/automations freely, but rejected it: if the raw data is available as HA sensors, a motivated user can reconstruct the same charts and trend analysis HA's own history/statistics graphing provides, at which point the **Analytics Surface** (the web UI) has no exclusive value — and any future **Monetization Path** that gates analytics behind a paid tier would be trivially bypassed by reading the same data for free via HA instead.

HA's genuine differentiated value here is *acting* on events — push notifications, smart-home-triggered automations — not being an analytics layer. The web UI can't do the former; HA isn't meant to do the latter.

## Consequences

- Any HA custom component / plugin subscribes to computed events (via API or MQTT) published by the backend, not to a raw data feed.
- If a future need arises to expose more granular data to HA, that's a deliberate revisit of this decision, not a default to "just expose everything" — evaluate it against whether it would let users bypass the Analytics Surface.
