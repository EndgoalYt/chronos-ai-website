import { createAdminClient, HttpError, requirePost, requireUser, serve } from "../_shared/http.ts";
import {
  applyVerifiedPayment,
  assertTransactionMatches,
  PurchaseRecord,
  verifiedTransactionEvent,
  verifyPaystackTransaction,
} from "../_shared/payments.ts";

serve(async (request) => {
  requirePost(request);
  const user = await requireUser(request);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .select("id,user_id,product_id,product_price_id,market_code,reference,amount_minor,currency,status,checkout_url")
    .eq("user_id", user.id)
    .neq("status", "refunded")
    .neq("status", "reversed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("Purchase restoration lookup failed:", error.message);
    throw new HttpError(500, "Purchase history could not be loaded.", "database_error");
  }

  const results: Array<{ reference: string; status: string; error?: string }> = [];
  for (const row of (data ?? []) as PurchaseRecord[]) {
    try {
      const transaction = await verifyPaystackTransaction(row.reference);
      assertTransactionMatches(transaction, row);
      const event = verifiedTransactionEvent(transaction, "restore-purchases");
      const result = await applyVerifiedPayment(admin, {
        eventId: event.eventId,
        eventType: event.eventType,
        purchase: row,
        status: event.status,
        amountMinor: event.amountMinor,
        transactionId: transaction.id,
      });
      results.push({ reference: row.reference, status: result.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction verification failed.";
      console.error("Purchase restoration verification failed:", row.reference, message);
      results.push({ reference: row.reference, status: "unverified", error: message });
    }
  }

  return Response.json({
    checked: results.length,
    restored: results.filter((result) => result.status === "paid").length,
    purchases: results,
  });
});
