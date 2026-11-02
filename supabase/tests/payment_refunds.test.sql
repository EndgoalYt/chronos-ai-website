begin;

create extension if not exists pgtap with schema extensions;

select plan(76);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'refund-full@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'refund-partial@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'refund-transfer@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'refund-duplicate@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'refund-invalid@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'refund-failed@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'refund-not-source@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'refund-cumulative@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'refund-reversal@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'refund-restore-reversal@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'refund-reversal-transfer@test.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

insert into public.purchases (
  id, user_id, product_id, product_price_id, market_code, reference,
  amount_minor, currency, status, paid_at
)
select fixtures.id, fixtures.user_id, 'ultimate', prices.id, 'US',
       fixtures.reference, 799, 'USD', fixtures.status, fixtures.paid_at
from (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'refund-full-001', 'paid', '2026-01-01 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'refund-partial-001', 'paid', '2026-01-02 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000003'::uuid, 'refund-transfer-old', 'paid', '2026-01-03 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000003'::uuid, 'refund-transfer-new', 'paid', '2026-01-04 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000004'::uuid, 'refund-duplicate-001', 'paid', '2026-01-05 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'refund-invalid-001', 'paid', '2026-01-06 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000007'::uuid, '10000000-0000-0000-0000-000000000006'::uuid, 'refund-failed-001', 'pending', null),
    ('20000000-0000-0000-0000-000000000008'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'refund-not-source-old', 'paid', '2026-01-07 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000009'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'refund-not-source-current', 'paid', '2026-01-08 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000010'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'refund-cumulative-001', 'paid', '2026-01-09 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000011'::uuid, '10000000-0000-0000-0000-000000000009'::uuid, 'refund-reversal-001', 'paid', '2026-01-10 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000012'::uuid, '10000000-0000-0000-0000-000000000010'::uuid, 'refund-restore-reversal-001', 'paid', '2026-01-11 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000013'::uuid, '10000000-0000-0000-0000-000000000011'::uuid, 'refund-reversal-transfer-old', 'paid', '2026-01-12 00:00:00+00'::timestamptz),
    ('20000000-0000-0000-0000-000000000014'::uuid, '10000000-0000-0000-0000-000000000011'::uuid, 'refund-reversal-transfer-new', 'paid', '2026-01-13 00:00:00+00'::timestamptz)
) as fixtures(id, user_id, reference, status, paid_at)
cross join lateral (
  select id from public.product_prices
  where product_id = 'ultimate' and market_code = 'US' and currency = 'USD'
) as prices;

insert into public.entitlements (
  user_id, product_id, source_purchase_id, status, granted_at
)
values
  ('10000000-0000-0000-0000-000000000001', 'ultimate', '20000000-0000-0000-0000-000000000001', 'active', now()),
  ('10000000-0000-0000-0000-000000000002', 'ultimate', '20000000-0000-0000-0000-000000000002', 'active', now()),
  ('10000000-0000-0000-0000-000000000003', 'ultimate', '20000000-0000-0000-0000-000000000003', 'active', now()),
  ('10000000-0000-0000-0000-000000000004', 'ultimate', '20000000-0000-0000-0000-000000000005', 'active', now()),
  ('10000000-0000-0000-0000-000000000007', 'ultimate', '20000000-0000-0000-0000-000000000009', 'active', now()),
  ('10000000-0000-0000-0000-000000000008', 'ultimate', '20000000-0000-0000-0000-000000000010', 'active', now()),
  ('10000000-0000-0000-0000-000000000009', 'ultimate', '20000000-0000-0000-0000-000000000011', 'active', now()),
  ('10000000-0000-0000-0000-000000000010', 'ultimate', '20000000-0000-0000-0000-000000000012', 'active', now()),
  ('10000000-0000-0000-0000-000000000011', 'ultimate', '20000000-0000-0000-0000-000000000013', 'active', now());

select is(
  (public.apply_verified_payment(
    'test:refund:full:1', 'refund-full-001', 'refund.processed',
    'refunded', 799, 'USD', 101
  )->>'duplicate')::boolean,
  false,
  'first full-refund event is processed'
);
select is(
  (select status from public.purchases where reference = 'refund-full-001'),
  'refunded',
  'full refund marks the purchase refunded'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000001'),
  'revoked',
  'full refund revokes the sourced entitlement'
);
select is(
  (public.apply_verified_payment(
    'paystack:transaction:101:reversed', 'refund-full-001', 'transaction.reversed',
    'reversed', 799, 'USD', 101
  )->>'status'),
  'refunded',
  'reversal after a full refund keeps refunded as the terminal purchase status'
);
select is(
  (select status from public.purchases where reference = 'refund-full-001'),
  'refunded',
  'purchase remains refunded after a later reversal event'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000001'),
  'revoked',
  'reversal after a full refund leaves entitlement revoked'
);

select is(
  (public.apply_verified_payment(
    'test:refund:partial:1', 'refund-partial-001', 'refund.processed',
    'partial_refunded', 250, 'USD', 102
  )->>'status'),
  'paid',
  'partial refund leaves purchase status paid'
);
select is(
  (select status from public.purchases where reference = 'refund-partial-001'),
  'paid',
  'partial refund does not change purchase status'
);
select is(
  (select paid_at from public.purchases where reference = 'refund-partial-001'),
  '2026-01-02 00:00:00+00'::timestamptz,
  'partial refund preserves paid timestamp'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000002'),
  'active',
  'partial refund retains the lifetime entitlement'
);
select is(
  (select payment_status from public.payment_events where provider_event_id = 'test:refund:partial:1'),
  'partial_refunded',
  'partial refund event is recorded with its distinct event status'
);

select is(
  (public.apply_verified_payment(
    'test:refund:transfer:1', 'refund-transfer-old', 'refund.processed',
    'refunded', 799, 'USD', 103
  )->>'status'),
  'refunded',
  'full refund is recorded when another paid purchase exists'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000003'),
  'active',
  'another paid purchase preserves the entitlement'
);
select is(
  (select source_purchase_id from public.entitlements where user_id = '10000000-0000-0000-0000-000000000003'),
  '20000000-0000-0000-0000-000000000004'::uuid,
  'entitlement source is transferred to the other paid purchase'
);

select is(
  (public.apply_verified_payment(
    'test:refund:duplicate:1', 'refund-duplicate-001', 'refund.processed',
    'partial_refunded', 250, 'USD', 104
  )->>'duplicate')::boolean,
  false,
  'first notification for a partial refund is processed'
);
select is(
  (public.apply_verified_payment(
    'test:refund:duplicate:1', 'refund-duplicate-001', 'refund.processed',
    'partial_refunded', 250, 'USD', 104
  )->>'duplicate')::boolean,
  true,
  'duplicate refund notification is ignored'
);
select is(
  (select count(*)::integer from public.payment_events where provider_event_id = 'test:refund:duplicate:1'),
  1,
  'duplicate refund notification creates only one payment event'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000004'),
  'active',
  'duplicate partial refund does not alter entitlement'
);
select throws_ok(
  $$select public.apply_verified_payment('test:refund:duplicate:1', 'refund-partial-001', 'refund.processed', 'partial_refunded', 250, 'USD', 102)$$,
  'P0001', 'Provider event ID conflicts with another payment event',
  'an existing refund event ID cannot be replayed against a different purchase'
);
select is(
  (select count(*)::integer from public.payment_events where provider_event_id = 'test:refund:duplicate:1'),
  1,
  'conflicting duplicate event does not create another payment event'
);

select throws_ok(
  $$select public.apply_verified_payment('test:invalid:zero', 'refund-invalid-001', 'refund.processed', 'partial_refunded', 0, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'zero partial refund amount is rejected'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:negative', 'refund-invalid-001', 'refund.processed', 'partial_refunded', -1, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'negative refund amount is rejected'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:excess', 'refund-invalid-001', 'refund.processed', 'partial_refunded', 800, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'excessive refund amount is rejected'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:partial-full', 'refund-invalid-001', 'refund.processed', 'partial_refunded', 799, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'partial-refund status rejects a full refund amount'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:full-partial', 'refund-invalid-001', 'refund.processed', 'refunded', 798, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'full-refund status rejects a partial refund amount'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:full-excess', 'refund-invalid-001', 'refund.processed', 'refunded', 800, 'USD', 105)$$,
  'P0001', 'Refund amount does not match refund status',
  'full-refund status rejects an excessive refund amount'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:currency', 'refund-invalid-001', 'refund.processed', 'partial_refunded', 250, 'EUR', 105)$$,
  'P0001', 'Verified transaction does not match purchase',
  'refund with a mismatched currency is rejected'
);
select throws_ok(
  $$select public.apply_verified_payment('test:invalid:purchase-reference', 'refund-reference-missing', 'refund.processed', 'partial_refunded', 250, 'USD', 105)$$,
  'P0001', 'Purchase reference not found',
  'refund with an unknown purchase reference is rejected'
);

select is(
  (public.apply_verified_payment(
    'test:payment:pending:1', 'refund-failed-001', 'charge.pending',
    'pending', 799, 'USD', 106
  )->>'status'),
  'pending',
  'pending payment remains pending'
);
select is(
  (select count(*)::integer from public.entitlements where user_id = '10000000-0000-0000-0000-000000000006'),
  0,
  'pending payment never grants an entitlement'
);
select is(
  (public.apply_verified_payment(
    'test:payment:failed:1', 'refund-failed-001', 'charge.failed',
    'failed', 799, 'USD', 106
  )->>'status'),
  'failed',
  'failed payment remains failed'
);
select is(
  (select status from public.purchases where reference = 'refund-failed-001'),
  'failed',
  'failed payment does not become paid'
);
select is(
  (select count(*)::integer from public.entitlements where user_id = '10000000-0000-0000-0000-000000000006'),
  0,
  'failed payment never grants an entitlement'
);

select is(
  (public.apply_verified_payment(
    'test:refund:not-source:1', 'refund-not-source-old', 'refund.processed',
    'refunded', 799, 'USD', 107
  )->>'status'),
  'refunded',
  'refund of a non-source paid purchase is recorded'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000007'),
  'active',
  'refund does not revoke an entitlement sourced from another purchase'
);
select is(
  (select source_purchase_id from public.entitlements where user_id = '10000000-0000-0000-0000-000000000007'),
  '20000000-0000-0000-0000-000000000009'::uuid,
  'refund does not replace a different current entitlement source'
);

select is(
  (public.apply_verified_payment(
    'test:refund:cumulative:1', 'refund-cumulative-001', 'refund.processed',
    'partial_refunded', 300, 'USD', 108
  )->>'status'),
  'paid',
  'first cumulative partial refund leaves purchase paid'
);
select is(
  (select status from public.purchases where reference = 'refund-cumulative-001'),
  'paid',
  'cumulative refund below purchase amount keeps purchase paid'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000008'),
  'active',
  'cumulative refund below purchase amount preserves entitlement'
);
select is(
  (public.apply_verified_payment(
    'test:refund:cumulative:1', 'refund-cumulative-001', 'refund.processed',
    'partial_refunded', 300, 'USD', 108
  )->>'duplicate')::boolean,
  true,
  'repeated cumulative refund event is ignored'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000010'),
  300::bigint,
  'duplicate does not increase cumulative refund amount'
);
select is(
  (public.apply_verified_payment(
    'test:refund:cumulative:final', 'refund-cumulative-001', 'refund.processed',
    'partial_refunded', 499, 'USD', 108
  )->>'status'),
  'refunded',
  'final refund of the remaining balance after an earlier partial reaches the original total'
);
select is(
  (select status from public.purchases where reference = 'refund-cumulative-001'),
  'refunded',
  'purchase becomes refunded when cumulative total equals original amount'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000008'),
  'revoked',
  'entitlement is revoked when cumulative refunds reach original amount'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000010'),
  799::bigint,
  'cumulative refund total is recorded exactly once'
);

select is(
  (public.apply_verified_payment(
    'test:refund:over-total:1', 'refund-invalid-001', 'refund.processed',
    'partial_refunded', 500, 'USD', 109
  )->>'status'),
  'paid',
  'first refund in over-total case remains partial'
);
select throws_ok(
  $$select public.apply_verified_payment('test:refund:over-total:2', 'refund-invalid-001', 'refund.processed', 'partial_refunded', 300, 'USD', 109)$$,
  'P0001', 'Cumulative refunds exceed the purchase amount',
  'refund bringing cumulative total above original amount is rejected'
);
select is(
  (select status from public.purchases where reference = 'refund-invalid-001'),
  'paid',
  'rejected cumulative over-refund leaves purchase paid'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000006'),
  500::bigint,
  'rejected event is rolled back and not counted'
);

select is(
  (public.apply_verified_payment(
    'test:refund:reversal:partial', 'refund-reversal-001', 'refund.processed',
    'partial_refunded', 300, 'USD', 110
  )->>'status'),
  'paid',
  'partial refund remains paid before provider reversal'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000009'),
  'active',
  'partial refund retains entitlement before provider reversal'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000011' and payment_status in ('partial_refunded', 'refunded')),
  300::bigint,
  'actual partial refund is recorded before provider reversal'
);
select is(
  (public.apply_verified_payment(
    'paystack:transaction:110:reversed', 'refund-reversal-001', 'transaction.reversed',
    'reversed', 799, 'USD', 110
  )->>'status'),
  'reversed',
  'verification reversal transitions partially refunded purchase to reversed'
);
select is(
  (select status from public.purchases where reference = 'refund-reversal-001'),
  'reversed',
  'reversed transaction persists as a distinct terminal purchase status'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000009'),
  'revoked',
  'reversed transaction revokes the sourced entitlement'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000011' and payment_status in ('partial_refunded', 'refunded')),
  300::bigint,
  'reversal amount is excluded from cumulative refund calculations'
);
select is(
  (select payment_status from public.payment_events where provider_event_id = 'paystack:transaction:110:reversed'),
  'reversed',
  'transaction reversal is stored separately from refund events'
);
select is(
  (select amount_minor from public.payment_events where provider_event_id = 'paystack:transaction:110:reversed'),
  799::bigint,
  'reversal event preserves the verified transaction amount as non-refund context'
);
select is(
  (public.apply_verified_payment(
    'paystack:transaction:110:reversed', 'refund-reversal-001', 'transaction.reversed',
    'reversed', 799, 'USD', 110
  )->>'duplicate')::boolean,
  true,
  'restoration replay of verification reversal is idempotent'
);
select is(
  (public.apply_verified_payment(
    'paystack:transaction:110:reversed', 'refund-reversal-001', 'transaction.reversed',
    'reversed', 799, 'USD', 110
  )->>'status'),
  'reversed',
  'restoration replay keeps the purchase reversed'
);
select is(
  (select count(*)::integer from public.payment_events where provider_event_id = 'paystack:transaction:110:reversed'),
  1,
  'verification and restoration share one reversal event'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000011' and payment_status in ('partial_refunded', 'refunded')),
  300::bigint,
  'restoration replay does not add the original charge to refund totals'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000009'),
  'revoked',
  'restoration replay does not restore reversed entitlement'
);

select is(
  (public.apply_verified_payment(
    'test:refund:restore-reversal:partial', 'refund-restore-reversal-001', 'refund.processed',
    'partial_refunded', 200, 'USD', 111
  )->>'status'),
  'paid',
  'partial refund remains paid before restoration detects reversal'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000010'),
  'active',
  'restoration case retains entitlement after partial refund'
);
select is(
  (public.apply_verified_payment(
    'paystack:transaction:111:reversed', 'refund-restore-reversal-001', 'transaction.reversed',
    'reversed', 799, 'USD', 111
  )->>'status'),
  'reversed',
  'restoration detects reversal after a partial refund'
);
select is(
  (select status from public.purchases where reference = 'refund-restore-reversal-001'),
  'reversed',
  'restoration stores a distinct reversed purchase status'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000010'),
  'revoked',
  'restoration reversal revokes the sourced entitlement'
);
select is(
  (public.apply_verified_payment(
    'test:refund:restore-reversal:late-success', 'refund-restore-reversal-001', 'verify-payment',
    'paid', 799, 'USD', 111
  )->>'status'),
  'reversed',
  'a later paid verification cannot reactivate a reversed purchase'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000010'),
  'revoked',
  'a later paid verification does not restore a reversed entitlement'
);
select is(
  (select sum(amount_minor)::bigint from public.payment_events where purchase_id = '20000000-0000-0000-0000-000000000012' and payment_status in ('partial_refunded', 'refunded')),
  200::bigint,
  'restoration reversal does not add the original charge to the refund total'
);
select is(
  (select payment_status from public.payment_events where provider_event_id = 'paystack:transaction:111:reversed'),
  'reversed',
  'restoration records reversal separately from processed refunds'
);

select is(
  (public.apply_verified_payment(
    'paystack:transaction:112:reversed', 'refund-reversal-transfer-old', 'transaction.reversed',
    'reversed', 799, 'USD', 112
  )->>'status'),
  'reversed',
  'reversal marks the source purchase reversed when another paid purchase exists'
);
select is(
  (select status from public.purchases where reference = 'refund-reversal-transfer-old'),
  'reversed',
  'reversal transfer case records the source purchase as reversed'
);
select is(
  (select status from public.entitlements where user_id = '10000000-0000-0000-0000-000000000011'),
  'active',
  'reversal transfers entitlement while preserving active access'
);
select is(
  (select source_purchase_id from public.entitlements where user_id = '10000000-0000-0000-0000-000000000011'),
  '20000000-0000-0000-0000-000000000014'::uuid,
  'reversal transfers entitlement to the other valid paid purchase'
);

select * from finish();
rollback;
