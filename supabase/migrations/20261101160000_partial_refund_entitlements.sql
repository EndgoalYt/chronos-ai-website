alter table public.payment_events
  drop constraint if exists payment_events_payment_status_check;

alter table public.payment_events
  add constraint payment_events_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'partial_refunded', 'refunded'));

create or replace function public.apply_verified_payment(
  p_provider_event_id text,
  p_reference text,
  p_event_type text,
  p_payment_status text,
  p_amount_minor bigint,
  p_currency text,
  p_transaction_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_inserted integer;
  v_replacement_purchase_id uuid;
  v_refunded_total bigint;
begin
  if p_payment_status is null
    or p_payment_status not in ('pending', 'paid', 'failed', 'partial_refunded', 'refunded') then
    raise exception 'Unsupported payment status';
  end if;

  select * into v_purchase
  from public.purchases
  where reference = p_reference
  for update;

  if not found then
    raise exception 'Purchase reference not found';
  end if;

  if p_currency is null or v_purchase.currency is distinct from p_currency then
    raise exception 'Verified transaction does not match purchase';
  end if;

  if p_payment_status in ('partial_refunded', 'refunded') then
    if p_amount_minor is null
      or p_amount_minor <= 0
      or (p_payment_status = 'partial_refunded' and p_amount_minor >= v_purchase.amount_minor)
      or (p_payment_status = 'refunded' and p_amount_minor <> v_purchase.amount_minor) then
      raise exception 'Refund amount does not match refund status';
    end if;
    if v_purchase.status not in ('paid', 'refunded') then
      raise exception 'Only a paid purchase can be refunded';
    end if;
  elsif p_amount_minor is null or v_purchase.amount_minor <> p_amount_minor then
    raise exception 'Verified transaction does not match purchase';
  end if;

  insert into public.payment_events (
    provider_event_id, purchase_id, reference, event_type,
    payment_status, amount_minor, currency
  )
  values (
    p_provider_event_id, v_purchase.id, p_reference, p_event_type,
    p_payment_status, p_amount_minor, p_currency
  )
  on conflict (provider_event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'duplicate', true,
      'status', v_purchase.status,
      'product_id', v_purchase.product_id
    );
  end if;

  if p_payment_status in ('partial_refunded', 'refunded') then
    select coalesce(sum(amount_minor), 0)
    into v_refunded_total
    from public.payment_events
    where purchase_id = v_purchase.id
      and payment_status in ('partial_refunded', 'refunded');

    if v_refunded_total > v_purchase.amount_minor then
      raise exception 'Cumulative refunds exceed the purchase amount';
    end if;
  end if;

  if v_purchase.status <> 'refunded' then
    if p_payment_status = 'paid' then
      update public.purchases
      set status = 'paid',
          paid_at = coalesce(paid_at, now()),
          paystack_transaction_id = coalesce(p_transaction_id, paystack_transaction_id)
      where id = v_purchase.id;

      insert into public.entitlements (
        user_id, product_id, source_purchase_id, status, granted_at, revoked_at
      )
      values (
        v_purchase.user_id, v_purchase.product_id, v_purchase.id,
        'active', now(), null
      )
      on conflict (user_id, product_id) do update
      set source_purchase_id = excluded.source_purchase_id,
          status = 'active',
          granted_at = now(),
          revoked_at = null,
          updated_at = now();
    elsif p_payment_status = 'failed' and v_purchase.status = 'pending' then
      update public.purchases
      set status = 'failed'
      where id = v_purchase.id;
    elsif p_payment_status in ('partial_refunded', 'refunded')
      and v_refunded_total < v_purchase.amount_minor then
      null;
    elsif p_payment_status in ('partial_refunded', 'refunded')
      and v_refunded_total = v_purchase.amount_minor then
      update public.purchases
      set status = 'refunded',
          refunded_at = coalesce(refunded_at, now())
      where id = v_purchase.id;

      select * into v_entitlement
      from public.entitlements
      where user_id = v_purchase.user_id
        and product_id = v_purchase.product_id
      for update;

      if found
        and v_entitlement.status = 'active'
        and v_entitlement.source_purchase_id = v_purchase.id then
        select id into v_replacement_purchase_id
        from public.purchases
        where user_id = v_purchase.user_id
          and product_id = v_purchase.product_id
          and status = 'paid'
          and id <> v_purchase.id
        order by paid_at desc nulls last, created_at desc
        limit 1;

        if v_replacement_purchase_id is null then
          update public.entitlements
          set status = 'revoked',
              revoked_at = coalesce(revoked_at, now()),
              updated_at = now()
          where id = v_entitlement.id;
        else
          update public.entitlements
          set source_purchase_id = v_replacement_purchase_id,
              status = 'active',
              revoked_at = null,
              updated_at = now()
          where id = v_entitlement.id;
        end if;
      end if;
    end if;
  end if;

  select * into v_purchase from public.purchases where id = v_purchase.id;

  return jsonb_build_object(
    'duplicate', false,
    'status', v_purchase.status,
    'product_id', v_purchase.product_id
  );
end;
$$;

revoke all on function public.apply_verified_payment(
  text, text, text, text, bigint, text, bigint
) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(
  text, text, text, text, bigint, text, bigint
) to service_role;
