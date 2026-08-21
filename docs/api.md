# Kaufland mobile API — reverse-engineering notes

Captured 2026-08-21 by intercepting the iOS Kaufland app (v6.15) with mitmproxy.
This documents the backend so that a **future auto-sync client** can be built
without re-doing the discovery. It is not yet implemented — the receipts host is
certificate-pinned (see below), so the app in use today is the PDF pipeline.

> Personal-data / interoperability use only: authenticate as yourself, fetch
> your own receipts. Unofficial, unaffiliated with Kaufland.

## Hosts and pinning status

| Host | Role | TLS interceptable? |
|---|---|---|
| `account.kaufland.com` | Identity provider — **cidaas** (Widas CIAM). OAuth2 / OIDC. | Not re-hit during capture (app had a cached session). Likely pinned. |
| `shop-mobile-bff.cloud.kaufland.de` | Marketplace/shop backend-for-frontend | **Yes** — plain JSON seen |
| `app.kaufland.net` | **Loyalty backend — Digitale Kassenbons live here** | **No — certificate-pinned** (18/18 TLS handshakes refused by client) |
| `swasc.kaufland.com` | Adobe Experience Edge analytics | Partially pinned; irrelevant |

**Consequence:** while the proxy is active the app cannot reach `app.kaufland.net`,
so the receipts screen shows *"Your digital receipts can't be loaded."* That error
is caused by interception, not a real outage.

## Authentication (cidaas OAuth2)

The access token is an **RS256 JWT** issued by cidaas. Decoded header/claims from
the captured `POST /auth/login` request to the shop BFF:

```
header: { "alg": "RS256", "kid": "5ec4c180-…", "typ": "at+jwt" }
claims:
  iss:        https://account.kaufland.com
  client_id:  72a21a5f-f5fd-4b0f-a292-3674663e3ac1
  aud:        72a21a5f-f5fd-4b0f-a292-3674663e3ac1
  scope:      profile openid cidaas:register cidaas:users_write phone
              identities groups roles offline_access address email
  roles:      ["USER"]
  exp/iat:    ~24h token lifetime
```

Key facts for a client:
- IdP is **cidaas** — standard OIDC discovery should live at
  `https://account.kaufland.com/.well-known/openid-configuration`.
- `offline_access` is granted ⇒ a **refresh token** exists ⇒ after one
  browser-based login the client can refresh headlessly (the `lidl-plus` model).
- The shop BFF accepts the cidaas access token as `Authorization: Bearer …` and
  exchanges it via `POST /auth/login` for its own session.

## Known shop-BFF endpoints (interceptable, not receipts)

Base: `https://shop-mobile-bff.cloud.kaufland.de`
Required headers observed: `authorization: Bearer <jwt>`, `app-version: 6.15`,
`accept-language: en`, `user-agent: Kaufland - Mobile App - Marketplace - iOS - 6.15 - (…)`

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | body `{access_token, …}`; exchanges cidaas token for shop session |
| GET | `/accounts/self` | returns `hashed_number`, `saldo`, `membershipStatus` |
| GET | `/carts/self` | shop cart summary |

## The missing piece

The receipt list/detail endpoints on `app.kaufland.net` were **not observed**,
because that host is pinned. Obtaining them requires unpinning the app on a
device we control — the plan is an **Android emulator + Frida** SSL-unpinning
session (nothing done to the physical iPhone). No endpoint guessing/brute-forcing.

### Next-phase checklist (Frida)
1. Android emulator (Google-APIs image, writable system) + Kaufland APK.
2. `frida` + an SSL-unpinning script → route through mitmproxy.
3. Open Digitale Kassenbons; capture list + detail + any PDF endpoint on
   `app.kaufland.net`, plus the cidaas `/authorize` + `/token` flow.
4. Fill in the table below and build `auth.py` (cidaas OAuth2 + refresh) and
   `api.py` (`list_receipts`, `get_receipt`, `get_pdf`) emitting the same
   `models.Receipt` the PDF path already produces.

| Method | Path (`app.kaufland.net`) | Purpose |
|---|---|---|
| ? | ? | list receipts |
| ? | ? | receipt detail |
| ? | ? | receipt PDF |

**Watch for** Play-Integrity / device attestation on `app.kaufland.net`; the app
also carries Kaufland Pay, so some endpoints may require an attested client.
```
