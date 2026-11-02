import { createAdminClient, HttpError, readJson, requirePost, requireUser, serve } from "../_shared/http.ts";
import {
  applyVerifiedPayment,
  assertTransactionMatches,
  findPurchase,
  validateReference,
  verifiedTransactionEvent,
  verifyPaystackTransaction,
} from "../_shared/payments.ts";

serve(async (request) => {
  requirePost(request);
  const user = await requireUser(request);
  const body = await readJson(request);
  const reference = validateReference(body.reference);
  const admin = createAdminClient();
  const purchase = await findPurchase(admin, reference, user.id);
  if (purchase.status === "refunded" || purchase.status === "reversed") {
    return Response.json({ status: purchase.status, edition: null, reference });
  }

  const transaction = await verifyPaystackTransaction(reference);
  assertTransactionMatches(transaction, purchase);
  const event = verifiedTransactionEvent(transaction, "verify-payment");
  const result = await applyVerifiedPayment(admin, {
    eventId: event.eventId,
    eventType: event.eventType,
    purchase,
    status: event.status,
    amountMinor: event.amountMinor,
    transactionId: transaction.id,
  });
  if (result.status === "refunded" || result.status === "reversed") {
    const message = result.status === "reversed"
      ? "This transaction was reversed and no longer grants paid access."
      : "This purchase has been refunded and no longer grants paid access.";
    throw new HttpError(
      402,
      message,
      result.status === "reversed" ? "purchase_reversed" : "purchase_refunded",
    );
  }
  return Response.json({
    status: result.status,
    edition: result.status === "paid" ? result.product_id : null,
    reference,
    duplicate: result.duplicate,
  });
});
