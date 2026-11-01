import { createAdminClient, HttpError, readJson, requirePost, requireUser, requiredEnv, serve } from "../_shared/http.ts";
import {
  enabledCurrencies,
  initializePaystackTransaction,
  paystackMode,
  paystackSecret,
} from "../_shared/payments.ts";

interface ProductPrice {
  id: string;
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
  const mode = paystackMode();
  if (mode === "unconfigured") {
    throw new HttpError(503, "Paystack checkout has not been configured.", "payment_configuration_error");
  }
  paystackSecret();
  const body = await readJson(request);
  const productId = body.product_id;
  const marketCode = body.market_code;
  if (
    (productId !== "plus" && productId !== "ultimate") ||
    typeof marketCode !== "string" ||
    !/^[A-Z]{2}$/.test(marketCode)
  ) {
    throw new HttpError(400, "Choose a valid paid edition and market.", "invalid_product");
  }

  const admin = createAdminClient();
  if (!user.email || !user.email_confirmed_at) {
    throw new HttpError(400, "Verify your account email before checkout.", "verified_email_required");
  }

  const { data: existingData, error: existingError } = await admin
    .from("purchases")
    .select("id,user_id,product_id,product_price_id,market_code,reference,amount_minor,currency,status,checkout_url")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingError) {
    console.error("Pending purchase lookup failed:", existingError.message);
    throw new HttpError(500, "A pending checkout could not be checked.", "database_error");
  }
  if (existingData) {
    const pending = existingData as {
      reference: string;
      market_code: string;
      checkout_url: string | null;
    };
    if (pending.market_code === marketCode && pending.checkout_url) {
      return Response.json({
        authorizationUrl: pending.checkout_url,
        reference: pending.reference,
        resumed: true,
        mode,
      });
    }
    throw new HttpError(
      409,
      "A checkout is already pending for this edition. Restore or verify that purchase before starting another.",
      "purchase_pending",
    );
  }

  let ownedQuery = admin
    .from("entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (productId === "plus") {
    ownedQuery = ownedQuery.in("product_id", ["plus", "ultimate"]);
  } else {
    ownedQuery = ownedQuery.eq("product_id", productId);
  }
  const { data: owned, error: ownedError } = await ownedQuery.maybeSingle();
  if (ownedError) {
    console.error("Entitlement lookup failed:", ownedError.message);
    throw new HttpError(500, "Current edition access could not be checked.", "database_error");
  }
  if (owned) {
    throw new HttpError(409, "This account already owns this edition.", "already_owned");
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id,active")
    .eq("id", productId)
    .maybeSingle();
  if (productError) {
    console.error("Product lookup failed:", productError.message);
    throw new HttpError(500, "Edition availability could not be checked.", "database_error");
  }
  if (!product?.active) {
    throw new HttpError(404, "This edition is not available.", "product_unavailable");
  }

  const { data: priceData, error: priceError } = await admin
    .from("product_prices")
    .select("id,product_id,market_code,currency,amount_minor,display_price,checkout_enabled")
    .eq("product_id", productId)
    .eq("market_code", marketCode)
    .maybeSingle();
  if (priceError) {
    console.error("Product price lookup failed:", priceError.message);
    throw new HttpError(500, "Regional pricing could not be checked.", "database_error");
  }
  if (!priceData) {
    throw new HttpError(404, "No price has been configured for this edition and market.", "price_unavailable");
  }
  const price = priceData as ProductPrice;
  if (!price.checkout_enabled || !enabledCurrencies().has(price.currency)) {
    throw new HttpError(
      409,
      "Checkout is unavailable for this market until the merchant account is configured for this currency.",
      "market_unavailable",
    );
  }

  const callbackUrl = new URL(requiredEnv("PAYMENT_CALLBACK_URL"));
  if (
    callbackUrl.protocol !== "https:" &&
    !(mode === "test" && ["localhost", "127.0.0.1"].includes(callbackUrl.hostname))
  ) {
    throw new HttpError(503, "The payment return URL must use HTTPS.", "payment_configuration_error");
  }
  const reference = `CHR-${crypto.randomUUID()}`;
  const { data: purchaseData, error: purchaseError } = await admin
    .from("purchases")
    .insert({
      user_id: user.id,
      product_id: productId,
      product_price_id: price.id,
      market_code: marketCode,
      reference,
      amount_minor: price.amount_minor,
      currency: price.currency,
      status: "pending",
    })
    .select("id")
    .single();
  if (purchaseError) {
    if (purchaseError.code === "23505") {
      throw new HttpError(409, "A checkout for this edition is already being created. Refresh and try again.", "purchase_pending");
    }
    console.error("Purchase creation failed:", purchaseError.message);
    throw new HttpError(500, "A secure checkout could not be created.", "database_error");
  }

  let initialized: Awaited<ReturnType<typeof initializePaystackTransaction>>;
  try {
    initialized = await initializePaystackTransaction(
      price.amount_minor,
      price.currency,
      user.email,
      reference,
      callbackUrl.toString(),
      {
        purchase_id: purchaseData.id,
        product_id: productId,
        user_id: user.id,
        market_code: marketCode,
      },
    );
  } catch (error) {
    const { error: updateError } = await admin
      .from("purchases")
      .update({ status: "failed" })
      .eq("id", purchaseData.id)
      .eq("status", "pending");
    if (updateError) {
      console.error("Failed checkout cleanup failed:", updateError.message);
    }
    throw error;
  }
  const { error: updateError } = await admin
    .from("purchases")
    .update({ checkout_url: initialized.authorization_url })
    .eq("id", purchaseData.id)
    .eq("status", "pending");
  if (updateError) {
    console.error("Checkout URL save failed:", updateError.message);
    throw new HttpError(500, "Checkout was created but could not be saved. Contact support with the transaction reference.", "database_error");
  }

  return Response.json({
    authorizationUrl: initialized.authorization_url,
    reference: initialized.reference,
    resumed: false,
    mode,
  });
});
