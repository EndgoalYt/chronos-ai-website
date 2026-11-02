import { createAdminClient, HttpError, requirePost, requireUser, serve } from "../_shared/http.ts";
import { createSignedLicense } from "../_shared/license.ts";
import { enabledCurrencies, isPaystackSecretConfigured, paystackMode } from "../_shared/payments.ts";

interface ActiveEntitlement {
  product_id: "plus" | "ultimate";
  status: "active";
  granted_at: string;
  updated_at: string;
}

interface PriceRow {
  product_id: string;
  market_code: string;
  currency: string;
  amount_minor: number;
  display_price: string;
  checkout_enabled: boolean;
}

serve(async (request) => {
  requirePost(request);
  const user = await requireUser(request);
  const admin = createAdminClient();
  const [entitlementsResult, pricesResult, purchasesResult] = await Promise.all([
    admin.from("entitlements")
      .select("product_id,status,granted_at,updated_at")
      .eq("user_id", user.id)
      .eq("status", "active"),
    admin.from("product_prices")
      .select("product_id,market_code,currency,amount_minor,display_price,checkout_enabled")
      .eq("product_id", "ultimate"),
    admin.from("purchases")
      .select("reference,product_id,status,currency,amount_minor,market_code,created_at,paid_at,refunded_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (entitlementsResult.error || pricesResult.error || purchasesResult.error) {
    console.error(
      "Entitlements lookup failed:",
      entitlementsResult.error?.message ?? pricesResult.error?.message ?? purchasesResult.error?.message,
    );
    throw new HttpError(500, "Account access could not be loaded.", "database_error");
  }

  const entitlements = (entitlementsResult.data ?? []) as ActiveEntitlement[];
  const ownsUltimate = entitlements.some((item) => item.product_id === "ultimate");
  const ownsPlus = ownsUltimate || entitlements.some((item) => item.product_id === "plus");
  const edition = ownsUltimate ? "ultimate" : ownsPlus ? "plus" : "free";
  const allowedCurrencies = enabledCurrencies();
  const mode = paystackMode();
  const paymentReady = isPaystackSecretConfigured(mode);
  const offers = ((pricesResult.data ?? []) as PriceRow[]).map((price) => ({
    productId: price.product_id,
    marketCode: price.market_code,
    currency: price.currency,
    amountMinor: price.amount_minor,
    displayPrice: price.display_price,
    available: paymentReady && price.checkout_enabled && allowedCurrencies.has(price.currency),
  }));
  const pendingOrFailedPurchases = (purchasesResult.data ?? [])
    .filter((purchase) => purchase.status === "pending" || purchase.status === "failed")
    .map((purchase) => ({
      reference: purchase.reference,
      productId: purchase.product_id,
      status: purchase.status,
      currency: purchase.currency,
      amountMinor: purchase.amount_minor,
      marketCode: purchase.market_code,
      createdAt: purchase.created_at,
    }));

  const license = ownsUltimate
    ? await createSignedLicense(user.id, edition, ownsPlus, ownsUltimate)
    : null;
  return Response.json({
    user: { id: user.id, email: user.email ?? null },
    edition,
    entitlements: {
      plus: { active: ownsPlus, lifetime: ownsPlus },
      ultimate: { active: ownsUltimate, lifetime: ownsUltimate },
      offlineAi: ownsUltimate && license !== null,
    },
    license,
    offers,
    paymentMode: paymentReady ? mode : "unconfigured",
    purchases: pendingOrFailedPurchases,
  }, { headers: { "cache-control": "no-store" } });
});
