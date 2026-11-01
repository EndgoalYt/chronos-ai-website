# Chronos AI lifetime purchases

This repository contains the GitHub Pages client and the Supabase backend for
one-time Plus and Ultimate purchases. It does not contain project credentials,
merchant credentials, or live payment configuration. All 17 supplied Ultimate
prices are seeded as **disabled**. Plus has no configured price because none was
provided. Do not enable a market until Paystack confirms the currency is
available to your merchant account.

The browser never grants paid access. Checkout creation requires a verified,
signed-in Supabase user. Both the return page and the Paystack webhook verify
the transaction with Paystack before an idempotent database function updates
the purchase and entitlement. Paid purchases are lifetime purchases, not
subscriptions.

## 1. Create a Supabase project

1. Create a project in the Supabase dashboard and save the database password
   securely.
2. In **Project Settings → API**, note the project URL and public anon/publishable
   key. The public key may be used in the website; never use the service-role
   key in website files.
3. In **Authentication → URL Configuration**, set the site URL to
   `https://endgoalyt.github.io/chronos-ai-website/` and add that URL, plus your
   local development URL, to the allowed redirect URLs.
4. Configure email confirmation and a suitable password policy. Checkout
   requires a confirmed email address.
5. In **Authentication → Providers → Email**, configure and test email delivery
   before opening account registration to the public.

The current project is a static GitHub Pages site. Do not enable public
registration until Supabase email confirmation, abuse protection, and account
recovery are configured for production.

## 2. Configure Paystack

1. Create and verify a Paystack merchant account and complete its business,
   settlement, and payout configuration.
2. Start with **test mode** and obtain that mode's secret key from Paystack.
   Never paste the secret key into HTML, JavaScript, GitHub Pages settings, or
   client-visible GitHub Actions variables.
3. Ask Paystack or check your merchant dashboard to verify which currencies your
   specific account can accept. Support varies by account, region, and currency.
   Do not assume that a currency is supported because it appears in the price
   list.
4. Do not enable any currency until its exact amount, currency, settlement, and
   test checkout have been verified for your account.

The migration seeds the supplied Ultimate prices in `product_prices` with
`checkout_enabled = false`. It does not add a Plus price. Only a trusted
administrator should enable a configured Ultimate price, after verifying the
currency with the merchant:

```sql
update public.product_prices
set checkout_enabled = true
where product_id = 'ultimate'
  and market_code = 'US'
  and currency = 'USD'
  and amount_minor = 799;
```

Repeat only for individually confirmed markets. If a market is not supported,
leave it disabled. The backend also checks the server-side
`PAYSTACK_ENABLED_CURRENCIES` allowlist, so a database toggle by itself cannot
make an unapproved currency purchasable. Do not use database tools from the
website to alter prices or availability.

No Plus price is set by this project. To launch Plus, first choose and approve a
price yourself, configure the merchant currency, and add its `product_prices`
row through trusted administration. Do not infer a Plus price from Ultimate.

## 3. Configure secrets safely

Install the Supabase CLI and link it to the project. Set Edge Function secrets
in the Supabase project, never in the browser bundle:

| Secret | Purpose |
| --- | --- |
| `PAYSTACK_MODE` | Exactly `test` or `live`; checked against the key prefix |
| `PAYSTACK_SECRET_KEY` | Server-only Paystack secret for that mode |
| `PAYSTACK_ENABLED_CURRENCIES` | Comma-separated currencies confirmed for this merchant, e.g. `USD`; an empty/unset value disables checkout |
| `SITE_URL` | Exact public site origin, e.g. `https://endgoalyt.github.io` |
| `PAYMENT_CALLBACK_URL` | HTTPS return URL, e.g. `https://endgoalyt.github.io/chronos-ai-website/?payment=return` |
| `ENTITLEMENT_SIGNING_PRIVATE_JWK` | Server-only ES256/P-256 private JWK for offline licences |
| `ENTITLEMENT_SIGNING_KEY_ID` | Public key identifier (`kid`) embedded in signed licences |

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The service-role key is highly
privileged: keep it in the Supabase function environment, never expose it to
the website, Windows app, or logs. `SUPABASE_ANON_KEY` is used server-side to
validate incoming user sessions.

Use the Supabase CLI's secret-management command to set the values. For example:

```text
supabase secrets set PAYSTACK_MODE=test PAYSTACK_SECRET_KEY=<test-secret> PAYSTACK_ENABLED_CURRENCIES=USD SITE_URL=https://endgoalyt.github.io PAYMENT_CALLBACK_URL=https://endgoalyt.github.io/chronos-ai-website/?payment=return ENTITLEMENT_SIGNING_KEY_ID=chronos-license-v1 ENTITLEMENT_SIGNING_PRIVATE_JWK=<private-jwk-json>
```

Run this in a private terminal, replacing placeholders locally. Do not commit
the command with real values or paste the output into issues or chat. For
multiple settings, use a local ignored env file and the CLI's `--env-file`
option. The repository ignores `.env` files; do not remove that protection.

Generate a P-256 key pair in a trusted environment. Keep the private JWK only in
Supabase secrets and back it up securely. The Windows application must pin the
matching **public** JWK in its own release. Never ship the private key in the
website or app. Plan key rotation: publish a new public key in the app before
switching the backend signing key, and retain old public keys until all tokens
they signed have expired.

For example, Node.js can generate an ES256-compatible key pair locally:

```text
node -e "const {generateKeyPairSync}=require('node:crypto'); const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}); console.log(JSON.stringify({privateJwk:privateKey.export({format:'jwk'}),publicJwk:publicKey.export({format:'jwk'})},null,2))"
```

Treat the printed `privateJwk` as a secret immediately: store it only in a
trusted secret manager/Supabase function secret, and distribute only
`publicJwk` to the Windows application team. This command is for generating
keys, not a production key embedded in this repository.

Configure the website public values in `config.js`:

```js
window.CHRONOS_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
});
```

The Supabase anon key is a public client key; database security depends on RLS
and server-side checks, not secrecy of this key. Never put a secret key in
`config.js`. If the Supabase project uses a custom domain, adjust the client
URL validation in `script.js` deliberately and keep HTTPS required.

## 4. Deploy the database and Edge Functions

From the repository root, install/authenticate the Supabase CLI, then:

```text
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy create-checkout
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook
supabase functions deploy get-entitlements
supabase functions deploy restore-purchases
```

The migration creates `profiles`, `products`, `product_prices`, `purchases`,
`entitlements`, and `payment_events`; adds the signup profile trigger, constraints,
indexes, and RLS policies; and inserts only the supplied Ultimate prices with
checkout disabled. Apply the migration through the CLI, not a browser-side SQL
request.

RLS allows authenticated users to read only their own profile, purchases, and
entitlements. Users cannot insert/update purchases or entitlements, or view
payment events. Only trusted Edge Functions use the service-role client and the
restricted `apply_verified_payment` database function to update payment state.
The webhook is the only function with gateway JWT verification disabled; it
validates Paystack's HMAC-SHA512 signature itself.

After deployment, set `SITE_URL` to the **origin only** (`https://endgoalyt.github.io`)
so successful and error responses include the correct CORS allow-origin header.
Do not use a wildcard origin in production.

## 5. Configure the Paystack webhook

In the Paystack dashboard, configure the webhook URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
```

Use the matching test webhook when running test mode, and the live webhook only
after switching the project to live mode. Paystack signs requests using the
matching secret key; the function validates `x-paystack-signature`, re-verifies
each supported transaction against Paystack, checks reference/amount/currency/
user/product metadata, and de-duplicates event bodies. Test that Paystack can
reach the deployed HTTPS endpoint before relying on webhooks.

## 6. Database and RLS configuration

The migration is the source of truth for schema and policies. In the Supabase
dashboard, verify that RLS is enabled on all six tables. Do not add a policy
that permits client writes to `purchases`, `entitlements`, or `payment_events`.
Do not grant browser clients the service-role role or execution permission on
`apply_verified_payment`.

The website lists all 17 Ultimate amounts exactly as supplied, but labels each
market unavailable until `get-entitlements` reports that its database row is
enabled **and** the currency is present in `PAYSTACK_ENABLED_CURRENCIES`.
Client-supplied amount, currency, product, or payment status is never used to
authorize access.

## 7. Test payments safely

Use a separate Supabase project and Paystack **test** keys. Keep the environment
at `PAYSTACK_MODE=test`; the backend rejects a live secret in test mode and a
test secret in live mode. Add only a currency available to the test merchant
account to `PAYSTACK_ENABLED_CURRENCIES` and enable only its exact seeded price.
Use Paystack's current test-payment instructions/cards from its dashboard/docs.
Do not invent a successful payment by editing an entitlement row or fabricating
a webhook; test access must result from a Paystack-verified test transaction.

Run the repository's static contract checks:

```text
node --test tests/payment-contract.test.js
node --check script.js
npx deno test --allow-env=SITE_URL,ENTITLEMENT_SIGNING_PRIVATE_JWK,ENTITLEMENT_SIGNING_KEY_ID supabase/functions/_shared
```

Before any live launch, also verify these cases against the test project:

| Case | Expected result |
| --- | --- |
| Checkout with no bearer token | `401`; no purchase is created |
| Unconfirmed user or unavailable market/currency | Rejected; no paid access |
| Pending Paystack transaction | Remains pending; no entitlement |
| Failed or abandoned transaction | Failed status; no entitlement |
| Amount, currency, reference, or metadata mismatch | Rejected; no entitlement |
| Return URL with a fabricated reference or `success` query | Does not grant access |
| Same signed webhook delivered repeatedly | One event effect; no duplicate entitlement |
| Invalid webhook signature | `401`; no database change |
| User A verifies User B's reference | `404`; no purchase details disclosed |
| User attempts browser SQL update/insert to their paid rows | Denied by grants/RLS |
| Restore for a verified paid transaction | Entitlement refreshed for that same user |
| Restore of unverified/pending/failed payment | No paid entitlement |
| Verified full or partial refund | Purchase marked refunded and access revoked unless another paid purchase remains |

After enabling the test market, test both desktop and narrow/mobile viewport
layouts, account creation/email verification, sign-in/sign-out, refresh,
restore, pending/failure messaging, and callback verification. Never run these
tests against live keys or change a production entitlement manually.

## 8. Switch from test to live

Do not switch until business verification, payouts, supported currencies, test
webhooks, support/refund policy, privacy notice, terms of sale, and live pricing
are confirmed. Then, in a controlled deployment:

1. Obtain the live Paystack secret from the merchant dashboard.
2. Confirm every enabled currency and seeded amount with the live merchant
   account.
3. Update Supabase secrets to `PAYSTACK_MODE=live`, the live secret, and only
   confirmed currencies. The backend enforces the `sk_live_` key prefix.
4. Enable only approved `product_prices` rows with a trusted database admin.
5. Configure the live Paystack webhook URL above and test its delivery using
   Paystack's supported live verification process without charging an
   unauthorized customer.
6. Confirm the GitHub Pages `config.js` contains only the project URL and public
   anon key, then publish the static files separately.
7. Monitor Edge Function errors, Paystack transactions/refunds, and Supabase
   audit logs. Keep test and live projects/credentials separated.

No production checkout should be advertised until these external steps have
been completed. The code in this repository is not proof of merchant approval
or currency support.

## 9. Flutter Windows app API

The Flutter app is not in this website repository and has not been modified.
Use the same Supabase project and Supabase Auth account. Sign in with Supabase
Auth in the app; send the user's current access token on authenticated
function requests. Base URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

Except for the Paystack webhook, call the following endpoints with `POST`,
`Authorization: Bearer <supabase-access-token>`, `apikey: <public-anon-key>`,
and JSON `Content-Type`:

| Endpoint | JSON request | Purpose |
| --- | --- | --- |
| `/get-entitlements` | `{}` | Edition, active flags, purchase state, offers, and signed offline licence |
| `/create-checkout` | `{"product_id":"ultimate","market_code":"US"}` | Creates/resumes a server-priced Paystack checkout; open returned `authorizationUrl` in the system browser |
| `/verify-payment` | `{"reference":"CHR-..."}` | Verifies a Paystack return reference and refreshes access |
| `/restore-purchases` | `{}` | Re-verifies this user's stored transactions |

`get-entitlements` returns `edition` (`free`, `plus`, or `ultimate`),
`entitlements.plus.active`, `entitlements.ultimate.active`,
`entitlements.offlineAi`, and `license`. An example shape:

```json
{
  "edition": "ultimate",
  "entitlements": {
    "plus": { "active": true, "lifetime": true },
    "ultimate": { "active": true, "lifetime": true },
    "offlineAi": true
  },
  "license": {
    "token": "<ES256-signed-JWT>",
    "expiresAt": "<UTC timestamp, at most 90 days after issue>",
    "keyId": "chronos-license-v1"
  }
}
```

`offlineAi` is false unless the active Ultimate entitlement has a configured
signing key and a signed licence was issued. The JWT header uses `alg=ES256`,
`typ=JWT`, and `kid`; claims include `iss`, `aud=chronos-ai-windows`,
`sub=<Supabase user UUID>`, `iat`, `exp`, `edition`, and
`entitlements.offline_ai`. Validate the signature against the app's pinned
public JWK, and check issuer, audience, expiry, user, edition, and
`offline_ai == true` before unlocking offline AI. Never trust a locally cached
edition string or an unsigned boolean. Refresh online at least every **90
days**; if the signature is invalid or the token expires, do not unlock offline
AI until refreshed. Secure cached tokens using Windows DPAPI.

After the user completes Paystack in the system browser, the app must call
`/verify-payment` with the returned transaction reference and then call
`/get-entitlements` again. The redirect itself is not proof of payment. Restore
uses the signed-in user's account; a reference belonging to another user must
not return that user's purchase. Treat `pending` as not paid and show a
retry/refresh path.

The 90-day signed token is an offline authorization window, not a subscription
term; the purchase remains lifetime. A fully offline client cannot learn about
a refund or revocation until it reconnects and refreshes. The app should stop
offline Ultimate access when the licence expires.
