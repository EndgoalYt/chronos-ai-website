import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { HttpError, requiredEnv } from "./http.ts";

export interface PurchaseRecord {
  id: string;
  user_id: string;
  product_id: "plus" | "ultimate";
  product_price_id: string;
  market_code: string;
  reference: string;
  amount_minor: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  checkout_url: string | null;
}

export interface PaystackTransaction {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: unknown;
}

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data?: T;
}

export function paystackSecret(): string {
  const mode = requiredEnv("PAYSTACK_MODE");
  const secret = requiredEnv("PAYSTACK_SECRET_KEY");
  const expectedPrefix = mode === "test" ? "sk_test_" : mode === "live" ? "sk_live_" : null;
  if (!expectedPrefix || !secret.startsWith(expectedPrefix)) {
    throw new HttpError(
      503,
      "Paystack mode and secret key do not match.",
      "payment_configuration_error",
    );
  }
  return secret;
}

export function isPaystackSecretConfigured(mode: "test" | "live" | "unconfigured"): boolean {
  if (mode === "unconfigured") return false;
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim() ?? "";
  return secret.startsWith(mode === "test" ? "sk_test_" : "sk_live_");
}

export function enabledCurrencies(): Set<string> {
  const configured = Deno.env.get("PAYSTACK_ENABLED_CURRENCIES")?.trim() ?? "";
  const currencies = configured.split(",").map((currency) => currency.trim().toUpperCase()).filter(Boolean);
  if (currencies.some((currency) => !/^[A-Z]{3}$/.test(currency))) {
    throw new HttpError(503, "The configured Paystack currency allowlist is invalid.", "payment_configuration_error");
  }
  return new Set(currencies);
}

export function validateReference(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{8,100}$/.test(value)) {
    throw new HttpError(400, "A valid transaction reference is required.", "invalid_reference");
  }
  return value;
}

export async function verifyPaystackTransaction(
  reference: string,
): Promise<PaystackTransaction> {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { authorization: `Bearer ${paystackSecret()}` },
      signal: AbortSignal.timeout(12_000),
    },
  );
  const result = await readPaystackResponse<PaystackTransaction>(response);
  if (!result.status || !result.data) {
    throw new HttpError(502, "Paystack could not verify this transaction.", "provider_verification_failed");
  }
  return result.data;
}

export async function initializePaystackTransaction(
  amountMinor: number,
  currency: string,
  email: string,
  reference: string,
  callbackUrl: string,
  metadata: Record<string, string>,
): Promise<{ authorization_url: string; reference: string }> {
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      authorization: `Bearer ${paystackSecret()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: amountMinor,
      currency,
      email,
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await readPaystackResponse<{
    authorization_url: string;
    reference: string;
  }>(response);
  if (
    !result.status ||
    !result.data?.authorization_url ||
    result.data.reference !== reference ||
    new URL(result.data.authorization_url).origin !== "https://checkout.paystack.com"
  ) {
    throw new HttpError(502, "Paystack did not return a valid checkout session.", "checkout_initialization_failed");
  }
  return result.data;
}

async function readPaystackResponse<T>(response: Response): Promise<PaystackResponse<T>> {
  let result: PaystackResponse<T>;
  try {
    result = await response.json() as PaystackResponse<T>;
  } catch {
    throw new HttpError(502, "Paystack returned an unreadable response.", "provider_error");
  }
  if (!response.ok) {
    throw new HttpError(502, "Paystack could not complete the request.", "provider_error");
  }
  return result;
}

export function assertTransactionMatches(
  transaction: PaystackTransaction,
  purchase: PurchaseRecord,
): void {
  if (
    transaction.reference !== purchase.reference ||
    transaction.amount !== purchase.amount_minor ||
    transaction.currency !== purchase.currency
  ) {
    throw new HttpError(409, "Verified payment details do not match this purchase.", "payment_mismatch");
  }

  const metadata = transaction.metadata;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    (metadata as Record<string, unknown>).purchase_id !== purchase.id ||
    (metadata as Record<string, unknown>).product_id !== purchase.product_id ||
    (metadata as Record<string, unknown>).user_id !== purchase.user_id
  ) {
    throw new HttpError(409, "The verified transaction is not linked to this account and product.", "payment_mismatch");
  }
}

export async function applyVerifiedPayment(
  admin: SupabaseClient,
  values: {
    eventId: string;
    eventType: string;
    purchase: PurchaseRecord;
    status: "pending" | "paid" | "failed" | "refunded";
    transactionId: number;
    eventAmountMinor?: number;
  },
): Promise<{ duplicate: boolean; status: string; product_id: string }> {
  const { data, error } = await admin.rpc("apply_verified_payment", {
    p_provider_event_id: values.eventId,
    p_reference: values.purchase.reference,
    p_event_type: values.eventType,
    p_payment_status: values.status,
    p_amount_minor: values.eventAmountMinor ?? values.purchase.amount_minor,
    p_currency: values.purchase.currency,
    p_transaction_id: values.transactionId,
  });
  if (error) {
    console.error("Payment state update failed:", error.message);
    throw new HttpError(500, "Payment was verified, but account access could not be refreshed.", "entitlement_update_failed");
  }
  return data as { duplicate: boolean; status: string; product_id: string };
}

export function transactionStatus(
  status: string,
): "pending" | "paid" | "failed" | "refunded" {
  if (status === "success") return "paid";
  if (status === "failed" || status === "abandoned") return "failed";
  if (status === "reversed") return "refunded";
  return "pending";
}

export async function findPurchase(
  admin: SupabaseClient,
  reference: string,
  userId?: string,
): Promise<PurchaseRecord> {
  let query = admin.from("purchases").select(
    "id,user_id,product_id,product_price_id,market_code,reference,amount_minor,currency,status,checkout_url",
  ).eq("reference", reference);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("Purchase lookup failed:", error.message);
    throw new HttpError(500, "Purchase status could not be loaded.", "database_error");
  }
  if (!data) {
    throw new HttpError(404, "No purchase was found for this account.", "purchase_not_found");
  }
  return data as PurchaseRecord;
}

export function paystackMode(): "test" | "live" | "unconfigured" {
  const mode = Deno.env.get("PAYSTACK_MODE")?.trim();
  if (!mode) return "unconfigured";
  if (mode !== "test" && mode !== "live") {
    throw new HttpError(503, "Paystack mode must be test or live.", "payment_configuration_error");
  }
  return mode;
}
