import { HttpError } from "./http.ts";
import {
  assertTransactionMatches,
  transactionStatus,
  validateReference,
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
    ["reversed", "refunded"],
    ["ongoing", "pending"],
  ];
  for (const [providerStatus, expected] of cases) {
    if (transactionStatus(providerStatus) !== expected) {
      throw new Error(`Unexpected mapping for ${providerStatus}.`);
    }
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

function expectHttpError(action: () => unknown, status: number): void {
  try {
    action();
  } catch (error) {
    if (error instanceof HttpError && error.status === status) return;
    throw error;
  }
  throw new Error(`Expected HTTP ${status}.`);
}
