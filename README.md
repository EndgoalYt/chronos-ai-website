# Chronos AI Website

A responsive static website for Chronos AI, hosted on GitHub Pages. It preserves
the existing plain HTML/CSS/JavaScript frontend and uses Supabase Edge Functions
for authentication, one-time lifetime checkout, payment verification, and
entitlements.

## Files

- `index.html` — existing site, editions, market pricing, and account section
- `styles.css` — branded responsive styling
- `script.js` — navigation and Supabase account/purchase UX
- `config.js` — public Supabase URL and anon-key placeholders (never secrets)
- `supabase/migrations/` — database schema, RLS, and disabled supplied prices
- `supabase/functions/` — secure checkout, verification, webhook, entitlement,
  and restoration endpoints
- `PAYMENTS_SETUP.md` — setup, deployment, testing, currency configuration, and
  Flutter Windows API instructions

## Run locally

Configure the public Supabase values in `config.js` after creating a project.
Serve the repository over HTTP(S); account auth, callback handling, and Edge
Function requests do not work from a `file://` URL. For example:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`. Configure that local redirect URL in
Supabase Auth if testing sign-in.

## Payments

Plus and Ultimate are lifetime one-time purchases, not subscriptions. The
provided Ultimate prices are seeded with checkout disabled, all currencies
remain unavailable until verified for the Paystack merchant, and no Plus price
is invented. Do not enable production checkout until external Supabase and
Paystack configuration is complete.

Follow [PAYMENTS_SETUP.md](./PAYMENTS_SETUP.md) for credentials, schema/RLS,
Edge Function deployment, webhook setup, safe testing, live-mode activation,
and Flutter integration. No secret keys belong in this static website.

## Publish on GitHub Pages

In repository **Settings → Pages**, choose deployment from the `main` branch
and repository root, then publish the static website files. Deploy the Supabase
migration and Edge Functions separately by following the setup guide. Do not
push credentials or an unreviewed live configuration to GitHub.

## Windows installer

The Windows download button remains disabled until a real tested installer is
published. Replace its placeholder URL only after a release is available, and
update supported-platform requirements based on the actual build.

## Notes

- Google Fonts is an optional online dependency; local fallback fonts remain.
- Keep large model files out of this website repository.
- Review model and third-party provider licenses before distribution.
