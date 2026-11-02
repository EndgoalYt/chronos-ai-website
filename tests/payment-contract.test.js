const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const prices = new Map([
  ['US', ['$7.99', 'USD', '799']],
  ['NG', ['₦7,900', 'NGN', '790000']],
  ['GB', ['£5.99', 'GBP', '599']],
  ['EZ', ['€6.99', 'EUR', '699']],
  ['CA', ['C$9.99', 'CAD', '999']],
  ['AU', ['A$11.99', 'AUD', '1199']],
  ['IN', ['₹399', 'INR', '39900']],
  ['PK', ['PKR 1,499', 'PKR', '149900']],
  ['BR', ['R$29.90', 'BRL', '2990']],
  ['ZA', ['R99.99', 'ZAR', '9999']],
  ['MY', ['RM19.90', 'MYR', '1990']],
  ['PH', ['₱299', 'PHP', '29900']],
  ['SG', ['S$9.98', 'SGD', '998']],
  ['JP', ['¥1,000', 'JPY', '1000']],
  ['KR', ['₩9,900', 'KRW', '9900']],
  ['TR', ['₺199.99', 'TRY', '19999']],
  ['MX', ['MX$99', 'MXN', '9900']],
]);

test('all supplied Ultimate regional display prices match the seeded database amounts', () => {
  const html = read('index.html');
  const sql = read('supabase/migrations/20261101000000_lifetime_entitlements.sql');
  for (const [market, [displayPrice, currency, amountMinor]] of prices) {
    assert.match(html, new RegExp(`<li data-market="${market}">[^<]*<span>[^<]+</span><strong>${escapeRegex(displayPrice)}</strong>`));
    assert.match(sql, new RegExp(`\\('ultimate', '${market}', '${currency}', ${amountMinor}, '${escapeRegex(displayPrice)}', false\\)`));
  }
  assert.equal((sql.match(/\('ultimate', '[A-Z]{2}', '[A-Z]{3}', \d+, '[^']+', false\)/g) ?? []).length, 17);
});

test('checkout remains disabled by default and Plus has no invented price', () => {
  const sql = read('supabase/migrations/20261101000000_lifetime_entitlements.sql');
  assert.equal((sql.match(/'ultimate', '[A-Z]{2}', '[A-Z]{3}', \d+, '[^']+', false/g) ?? []).length, 17);
  assert.doesNotMatch(sql, /'plus', '[A-Z]{2}', '[A-Z]{3}'/);
  assert.match(read('index.html'), /data-checkout-product="plus" disabled/);
});

test('payment functions and user-isolated RLS policies are present', () => {
  const functions = [
    'create-checkout',
    'verify-payment',
    'paystack-webhook',
    'get-entitlements',
    'restore-purchases',
  ];
  for (const name of functions) {
    assert.ok(fs.existsSync(path.join(root, 'supabase', 'functions', name, 'index.ts')), `${name} exists`);
  }
  const sql = read('supabase/migrations/20261101000000_lifetime_entitlements.sql');
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /revoke all on public\.profiles, public\.products, public\.product_prices,[\s\S]*from anon, authenticated/);
  assert.match(sql, /revoke all on function public\.apply_verified_payment[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.apply_verified_payment[\s\S]*to service_role/);
});

test('Ultimate offline AI is exclusive and uses a 90-day signed licence', () => {
  const html = read('index.html');
  const api = read('supabase/functions/get-entitlements/index.ts');
  const license = read('supabase/functions/_shared/license.ts');
  assert.match(html, /Extended online AI features/);
  assert.match(html, /Offline AI mode and local model management are planned for Ultimate only/);
  assert.match(html, /refreshed online at least every 90 days/);
  assert.match(license, /90 \* 24 \* 60 \* 60/);
  assert.match(api, /offlineAi: ownsUltimate && license !== null/);
});

test('refunds stay bounded and reversed transactions use a distinct terminal state', () => {
  const webhook = read('supabase/functions/paystack-webhook/index.ts');
  const migration = read('supabase/migrations/20261101000000_lifetime_entitlements.sql');
  const forwardMigration = read('supabase/migrations/20261101160000_partial_refund_entitlements.sql');
  const cumulativeMigration = read('supabase/migrations/20261101170000_cumulative_partial_refunds.sql');
  const integrityMigration = read('supabase/migrations/20261101200600_refund_event_integrity.sql');
  const reversalMigration = read('supabase/migrations/20261101220000_reversed_transaction_state.sql');
  const payments = read('supabase/functions/_shared/payments.ts');
  const paymentTests = read('supabase/functions/_shared/payments_test.ts');
  const migrationTests = read('supabase/tests/payment_refunds.test.sql');
  const verify = read('supabase/functions/verify-payment/index.ts');
  const restore = read('supabase/functions/restore-purchases/index.ts');
  assert.match(migration, /check \(payment_status in \('pending', 'paid', 'failed', 'partial_refunded', 'refunded'\)\)/);
  assert.match(migration, /check \(status in \('pending', 'paid', 'failed', 'refunded'\)\)/);
  assert.match(migration, /p_payment_status = 'partial_refunded' and p_amount_minor >= v_purchase\.amount_minor/);
  assert.match(migration, /p_payment_status = 'refunded' and p_amount_minor <> v_purchase\.amount_minor/);
  assert.match(migration, /sum\(amount_minor\)[\s\S]*payment_status in \('partial_refunded', 'refunded'\)/);
  assert.match(migration, /v_refunded_total > v_purchase\.amount_minor/);
  assert.match(migration, /v_refunded_total = v_purchase\.amount_minor/);
  assert.match(migration, /v_entitlement\.source_purchase_id = v_purchase\.id/);
  assert.match(migration, /set source_purchase_id = v_replacement_purchase_id/);
  assert.match(migration, /on conflict \(provider_event_id\) do nothing/);
  assert.match(migration, /where reference = p_reference\s+for update/);
  assert.match(payments, /export type PaymentEventStatus = PurchaseStatus \| "partial_refunded"/);
  assert.match(payments, /status: PaymentEventStatus/);
  assert.match(forwardMigration, /drop constraint if exists payment_events_payment_status_check/);
  assert.match(forwardMigration, /grant execute on function public\.apply_verified_payment[\s\S]*to service_role/);
  const functionDefinition = sql => sql.match(/create or replace function public\.apply_verified_payment\([\s\S]*?\n\$\$;/)?.[0];
  assert.equal(functionDefinition(forwardMigration), functionDefinition(migration));
  assert.equal(functionDefinition(cumulativeMigration), functionDefinition(migration));
  assert.match(cumulativeMigration, /v_refunded_total/);
  assert.match(integrityMigration, /Provider event ID conflicts with another payment event/);
  assert.match(integrityMigration, /security definer\s+set search_path = ''/);
  assert.match(integrityMigration, /where reference = p_reference\s+for update/);
  assert.match(integrityMigration, /grant execute on function public\.apply_verified_payment[\s\S]*to service_role/);
  assert.match(reversalMigration, /check \(status in \('pending', 'paid', 'failed', 'refunded', 'reversed'\)\)/);
  assert.match(reversalMigration, /check \(payment_status in \('pending', 'paid', 'failed', 'partial_refunded', 'refunded', 'reversed'\)\)/);
  assert.match(reversalMigration, /elsif p_payment_status = 'reversed' then[\s\S]*set status = 'reversed'/);
  assert.match(reversalMigration, /payment_status in \('partial_refunded', 'refunded'\)/);
  assert.match(reversalMigration, /v_purchase\.status not in \('refunded', 'reversed'\)/);
  assert.match(reversalMigration, /v_terminal_revocation/);
  assert.match(reversalMigration, /grant execute on function public\.apply_verified_payment[\s\S]*to service_role/);
  assert.match(webhook, /parseRefundAmountMinor\(event\.data\.amount\)/);
  assert.match(webhook, /paystackRefundEventId\(event\.data\.refund_reference\)/);
  assert.match(webhook, /missing a stable refund reference/);
  assert.match(payments, /paystack:refund:\$\{refundId\}/);
  assert.match(payments, /typeof amount === "string" && \/\^\\d\+\$\/\.test\(amount\)/);
  assert.match(paymentTests, /classifyRefundAmount/);
  assert.match(paymentTests, /verifiedTransactionEvent/);
  assert.match(payments, /paystack:transaction:\$\{transaction\.id\}:reversed/);
  assert.match(verify, /verifiedTransactionEvent\(transaction, "verify-payment"\)/);
  assert.match(restore, /verifiedTransactionEvent\(transaction, "restore-purchases"\)/);
  assert.match(restore, /\.neq\("status", "reversed"\)/);
  assert.equal((migrationTests.match(/^\s*select (?:is|throws_ok)\(/gm) ?? []).length, 76);
  for (const behavior of [
    'full refund revokes the sourced entitlement',
    'partial refund retains the lifetime entitlement',
    'partial refund preserves paid timestamp',
    'entitlement source is transferred to the other paid purchase',
    'duplicate refund notification is ignored',
    'zero partial refund amount is rejected',
    'negative refund amount is rejected',
    'excessive refund amount is rejected',
    'failed payment never grants an entitlement',
    'cumulative refund below purchase amount keeps purchase paid',
    'cumulative refund below purchase amount preserves entitlement',
    'duplicate does not increase cumulative refund amount',
    'final refund of the remaining balance after an earlier partial reaches the original total',
    'entitlement is revoked when cumulative refunds reach original amount',
    'refund bringing cumulative total above original amount is rejected',
    'rejected event is rolled back and not counted',
    'an existing refund event ID cannot be replayed against a different purchase',
    'refund with a mismatched currency is rejected',
    'refund with an unknown purchase reference is rejected',
    'pending payment never grants an entitlement',
    'verification reversal transitions partially refunded purchase to reversed',
    'reversal after a full refund keeps refunded as the terminal purchase status',
    'reversal after a full refund leaves entitlement revoked',
    'reversed transaction persists as a distinct terminal purchase status',
    'reversed transaction revokes the sourced entitlement',
    'reversal amount is excluded from cumulative refund calculations',
    'transaction reversal is stored separately from refund events',
    'restoration replay of verification reversal is idempotent',
    'verification and restoration share one reversal event',
    'restoration replay does not add the original charge to refund totals',
    'restoration replay does not restore reversed entitlement',
    'restoration detects reversal after a partial refund',
    'restoration reversal revokes the sourced entitlement',
    'restoration reversal does not add the original charge to the refund total',
    'a later paid verification cannot reactivate a reversed purchase',
    'a later paid verification does not restore a reversed entitlement',
    'reversal transfers entitlement to the other valid paid purchase',
  ]) {
    assert.ok(migrationTests.includes(behavior), `SQL regression case exists: ${behavior}`);
  }
});

test('website source contains no private payment or service-role credentials', () => {
  const clientFiles = ['index.html', 'script.js', 'config.js', 'styles.css'];
  for (const file of clientFiles) {
    const contents = read(file);
    assert.doesNotMatch(contents, /sk_(?:test|live)_[A-Za-z0-9]{12,}/);
    assert.doesNotMatch(contents, /service[_-]?role[_-]?key\s*[:=]\s*["'][^"']{12,}/i);
  }
  assert.doesNotMatch(read('script.js'), /localStorage|isPremium/);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
