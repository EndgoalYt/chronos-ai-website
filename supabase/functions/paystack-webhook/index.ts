import { createAdminClient, HttpError, serve } from "../_shared/http.ts";
import {
  applyVerifiedPayment,
  assertTransactionMatches,
  findPurchase,
  paystackSecret,
  transactionStatus,
  verifyPaystackTransaction,
} from "../_shared/payments.ts";

interface PaystackEvent {
  event?: string;
  data?: {
    reference?: string;
    transaction_reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
  };
}

serve(async (request) => {
  if (request.method !== "POST") {
    throw new HttpError(405, "Use POST for this endpoint.", "method_not_allowed");
  }
  const rawBody = await request.text();
  if (rawBody.length > 65_536) {
    throw new HttpError(413, "Webhook payload is too large.", "payload_too_large");
  }

  const signature = request.headers.get("x-paystack-signature") ?? "";
  const secret = paystackSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!constantTimeEqual(signature.toLowerCase(), expected)) {
    throw new HttpError(401, "Webhook signature is invalid.", "invalid_signature");
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody) as PaystackEvent;
  } catch {
    throw new HttpError(400, "Webhook payload is not valid JSON.", "invalid_webhook");
  }
  if (!event.event || !event.data) {
    throw new HttpError(400, "Webhook payload is incomplete.", "invalid_webhook");
  }

  const isRefund = event.event === "refund.processed" && event.data.status === "processed";
  if (event.event !== "charge.success" && event.event !== "charge.failed" && !isRefund) {
    return Response.json({ received: true, ignored: true });
  }

  const reference = isRefund
    ? event.data.transaction_reference ?? event.data.reference
    : event.data.reference;
  if (typeof reference !== "string" || !/^[A-Za-z0-9._-]{8,100}$/.test(reference)) {
    throw new HttpError(400, "Webhook transaction reference is invalid.", "invalid_webhook");
  }
  const admin = createAdminClient();
  const purchase = await findPurchase(admin, reference);
  const transaction = await verifyPaystackTransaction(reference);
  assertTransactionMatches(transaction, purchase);

  if (isRefund) {
    if (
      (transaction.status !== "success" && transaction.status !== "reversed") ||
      !Number.isSafeInteger(event.data.amount) ||
      (event.data.amount as number) < 1 ||
      (event.data.amount as number) > purchase.amount_minor ||
      event.data.currency !== purchase.currency
    ) {
      throw new HttpError(409, "Refund details do not match the verified purchase.", "payment_mismatch");
    }
  }

  const status = isRefund ? "refunded" : transactionStatus(transaction.status);
  if (
    (event.event === "charge.success" && status !== "paid") ||
    (event.event === "charge.failed" && status !== "failed")
  ) {
    throw new HttpError(409, "Webhook event does not match the verified Paystack status.", "payment_mismatch");
  }

  const bodyDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)),
  );
  const eventId = `webhook:${[...bodyDigest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const result = await applyVerifiedPayment(admin, {
    eventId,
    eventType: event.event,
    purchase,
    status,
    transactionId: transaction.id,
    ...(isRefund ? { eventAmountMinor: event.data.amount } : {}),
  });
  return Response.json({ received: true, duplicate: result.duplicate, status: result.status });
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
