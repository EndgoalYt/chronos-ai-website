import { HttpError } from "./http.ts";
import {
  assertTransactionMatches,
  classifyRefundAmount,
  parseRefundAmountMinor,
  paystackRefundEventId,
  transactionStatus,
  validateReference,
  verifiedTransactionEvent,
  type PaystackTransaction,
  type PurchaseRecord,
} from "./payments.ts";

Deno.test("transaction references are validated before Paystack requests", () => {
  const reference = "CHR-53a087fb-73a3-4f4f-9891-03f943f24e80";
  if (validateReference(reference) !== reference) throw new Error("Valid reference changed.");
  expectHttpError(() => validateReference("../another-user"), 400);
});

Deno.test("pending, paid, failed, abandoned, and reversed states stay distinct", () => {
  const cases: Array<[string, string]> = [
    ["success", "paid"],
    ["failed", "failed"],
    ["abandoned", "failed"],
    ["reversed", "reversed"],
    ["ongoing", "pending"],
  ];
  for (const [providerStatus, expected] of cases) {
    if (transactionStatus(providerStatus) !== expected) {
      throw new Error(`Unexpected mapping for ${providerStatus}.`);
    }
  }
});

Deno.test("reversed verification and restoration use one non-refund event", () => {
  const transaction: PaystackTransaction = {
    id: 123,
    reference: "CHR-53a087fb-73a3-4f4f-9891-03f943f24e80",
    status: "reversed",
    amount: 799,
    currency: "USD",
  };
  const verified = verifiedTransactionEvent(transaction, "verify-payment");
  const restored = verifiedTransactionEvent(transaction, "restore-purchases");

  if (
    verified.eventId !== "paystack:transaction:123:reversed" ||
    verified.eventId !== restored.eventId ||
    verified.eventType !== "transaction.reversed" ||
    verified.eventType !== restored.eventType ||
    verified.status !== "reversed" ||
    restored.status !== "reversed" ||
    verified.amountMinor !== transaction.amount ||
    restored.amountMinor !== transaction.amount
  ) {
    throw new Error("Reversed verification and restoration must share one event.");
  }
});

Deno.test("verified payment metadata must match its stored owner, product, amount, and currency", () => {
  const purchase: PurchaseRecord = {
    id: "f48658f9-3c72-4f29-86d5-4921582b3a5e",
    user_id: "a1b66f26-4320-4c5f-94d9-f4fd53556f03",
    product_id: "ultimate",
    product_price_id: "9d6807f8-e887-4aeb-97b8-87131a139e9a",
    market_code: "US",
    reference: "CHR-53a087fb-73a3-4f4f-9891-03f943f24e80",
    amount_minor: 799,
    currency: "USD",
    status: "pending",
    checkout_url: null,
  };
  const transaction: PaystackTransaction = {
    id: 123,
    reference: purchase.reference,
    status: "success",
    amount: purchase.amount_minor,
    currency: purchase.currency,
    metadata: {
      purchase_id: purchase.id,
      product_id: purchase.product_id,
      user_id: purchase.user_id,
    },
  };
  assertTransactionMatches(transaction, purchase);

  expectHttpError(() => assertTransactionMatches({
    ...transaction,
    metadata: { ...transaction.metadata as Record<string, string>, user_id: "another-user" },
  }, purchase), 409);
  expectHttpError(() => assertTransactionMatches({
    ...transaction,
    amount: purchase.amount_minor + 1,
  }, purchase), 409);
  expectHttpError(() => assertTransactionMatches({
    ...transaction,
    currency: "EUR",
  }, purchase), 409);
});

Deno.test("refund amounts distinguish partial and full refunds and reject invalid values", () => {
  if (parseRefundAmountMinor("250") !== 250) {
    throw new Error("Paystack string amounts must parse as integer minor units.");
  }
  if (classifyRefundAmount(250, 799) !== "partial_refunded") {
    throw new Error("A refund below the purchase amount must be partial.");
  }
  if (classifyRefundAmount(799, 799) !== "refunded") {
    throw new Error("A refund equal to the purchase amount must be full.");
  }

  for (const amount of [
    0,
    -1,
    800,
    799.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "0",
    "-1",
    "799.5",
    "not-an-amount",
    "9007199254740992",
  ]) {
    expectHttpError(() => classifyRefundAmount(amount, 799), 400);
  }
});

Deno.test("refund notification identifiers are stable for idempotent processing", () => {
  const first = paystackRefundEventId(12345);
  const retry = paystackRefundEventId(12345);
  if (!first || first !== retry) throw new Error("Repeated refund identifiers must map to the same event.");
  if (paystackRefundEventId(0) !== null || paystackRefundEventId("../invalid") !== null) {
    throw new Error("Invalid refund identifiers must be rejected.");
  }
  if (paystackRefundEventId("refund-reference-123") !== "paystack:refund:refund-reference-123") {
    throw new Error("Paystack refund references must provide stable event identifiers.");
  }
});

function expectHttpError(action: () => unknown, status: number): void {
  try {
    action();
  } catch (error) {
    if (error instanceof HttpError && error.status === status) return;
    throw error;
  }
  throw new Error(`Expected HTTP ${status}.`);
}
