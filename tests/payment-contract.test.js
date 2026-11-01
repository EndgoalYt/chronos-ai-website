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

test('verified partial refunds are bounded by the original charge and revoke access', () => {
  const webhook = read('supabase/functions/paystack-webhook/index.ts');
  const migration = read('supabase/migrations/20261101000000_lifetime_entitlements.sql');
  assert.match(webhook, /event\.data\.amount as number\) > purchase\.amount_minor/);
  assert.match(migration, /p_payment_status = 'refunded'[\s\S]*p_amount_minor > v_purchase\.amount_minor/);
  assert.match(migration, /set status = 'revoked'/);
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
