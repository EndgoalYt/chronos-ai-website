import { createAdminClient, HttpError, readJson, requirePost, requireUser, serve } from "../_shared/http.ts";
import {
  applyVerifiedPayment,
  assertTransactionMatches,
  findPurchase,
  transactionStatus,
  validateReference,
  verifyPaystackTransaction,
} from "../_shared/payments.ts";

serve(async (request) => {
  requirePost(request);
  const user = await requireUser(request);
  const body = await readJson(request);
  const reference = validateReference(body.reference);
  const admin = createAdminClient();
  const purchase = await findPurchase(admin, reference, user.id);
  if (purchase.status === "refunded") {
    return Response.json({ status: "refunded", edition: null, reference });
  }

  const transaction = await verifyPaystackTransaction(reference);
  assertTransactionMatches(transaction, purchase);
  const status = transactionStatus(transaction.status);
  const result = await applyVerifiedPayment(admin, {
    eventId: `verify:${reference}:${transaction.status}:${transaction.amount}`,
    eventType: "verify-payment",
    purchase,
    status,
    transactionId: transaction.id,
  });
  if (result.status === "refunded") {
    throw new HttpError(402, "This purchase has been refunded and no longer grants paid access.", "purchase_refunded");
  }
  return Response.json({
    status: result.status,
    edition: result.status === "paid" ? result.product_id : null,
    reference,
    duplicate: result.duplicate,
  });
});
