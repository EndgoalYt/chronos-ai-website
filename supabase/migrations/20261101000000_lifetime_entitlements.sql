create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id text primary key check (id in ('free', 'plus', 'ultimate')),
  name text not null,
  purchase_type text not null default 'lifetime'
    check (purchase_type = 'lifetime'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id),
  market_code text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  display_price text not null,
  checkout_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, market_code)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null references public.products (id),
  product_price_id uuid not null references public.product_prices (id),
  market_code text not null,
  reference text not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded')),
  checkout_url text,
  paystack_transaction_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  constraint purchases_paid_product_check check (product_id in ('plus', 'ultimate'))
);

create unique index purchases_one_pending_per_user_product
  on public.purchases (user_id, product_id)
  where status = 'pending';

create index purchases_user_created_idx on public.purchases (user_id, created_at desc);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null references public.products (id),
  source_purchase_id uuid not null references public.purchases (id),
  status text not null check (status in ('active', 'revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, product_id),
  constraint entitlements_paid_product_check check (product_id in ('plus', 'ultimate'))
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  purchase_id uuid references public.purchases (id),
  reference text not null,
  event_type text not null,
  payment_status text not null
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz not null default now()
);

create index payment_events_purchase_received_idx
  on public.payment_events (purchase_id, received_at desc);

insert into public.products (id, name) values
  ('free', 'Free'),
  ('plus', 'Plus'),
  ('ultimate', 'Ultimate')
on conflict (id) do update set name = excluded.name;

insert into public.product_prices
  (product_id, market_code, currency, amount_minor, display_price, checkout_enabled)
values
  ('ultimate', 'US', 'USD', 799, '$7.99', false),
  ('ultimate', 'NG', 'NGN', 790000, '₦7,900', false),
  ('ultimate', 'GB', 'GBP', 599, '£5.99', false),
  ('ultimate', 'EZ', 'EUR', 699, '€6.99', false),
  ('ultimate', 'CA', 'CAD', 999, 'C$9.99', false),
  ('ultimate', 'AU', 'AUD', 1199, 'A$11.99', false),
  ('ultimate', 'IN', 'INR', 39900, '₹399', false),
  ('ultimate', 'PK', 'PKR', 149900, 'PKR 1,499', false),
  ('ultimate', 'BR', 'BRL', 2990, 'R$29.90', false),
  ('ultimate', 'ZA', 'ZAR', 9999, 'R99.99', false),
  ('ultimate', 'MY', 'MYR', 1990, 'RM19.90', false),
  ('ultimate', 'PH', 'PHP', 29900, '₱299', false),
  ('ultimate', 'SG', 'SGD', 998, 'S$9.98', false),
  ('ultimate', 'JP', 'JPY', 1000, '¥1,000', false),
  ('ultimate', 'KR', 'KRW', 9900, '₩9,900', false),
  ('ultimate', 'TR', 'TRY', 19999, '₺199.99', false),
  ('ultimate', 'MX', 'MXN', 9900, 'MX$99', false)
on conflict (product_id, market_code) do update
set currency = excluded.currency,
    amount_minor = excluded.amount_minor,
    display_price = excluded.display_price;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger product_prices_set_updated_at
before update on public.product_prices
for each row execute function public.set_updated_at();

create trigger purchases_set_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

create trigger entitlements_set_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

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
  v_inserted integer;
  v_replacement_purchase_id uuid;
begin
  if p_payment_status not in ('pending', 'paid', 'failed', 'refunded') then
    raise exception 'Unsupported payment status';
  end if;

  select * into v_purchase
  from public.purchases
  where reference = p_reference
  for update;

  if not found then
    raise exception 'Purchase reference not found';
  end if;

  if v_purchase.currency <> p_currency
    or (
      (p_payment_status = 'refunded'
        and (p_amount_minor < 1 or p_amount_minor > v_purchase.amount_minor))
      or (p_payment_status <> 'refunded'
        and v_purchase.amount_minor <> p_amount_minor)
    ) then
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
    elsif p_payment_status = 'refunded' then
      update public.purchases
      set status = 'refunded',
          refunded_at = coalesce(refunded_at, now())
      where id = v_purchase.id;

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
        where user_id = v_purchase.user_id
          and product_id = v_purchase.product_id;
      else
        update public.entitlements
        set source_purchase_id = v_replacement_purchase_id,
            status = 'active',
            revoked_at = null,
            updated_at = now()
        where user_id = v_purchase.user_id
          and product_id = v_purchase.product_id;
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

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.payment_events enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Product catalogue is readable"
  on public.products for select to anon, authenticated
  using (active);

create policy "Product prices are readable"
  on public.product_prices for select to anon, authenticated
  using (true);

create policy "Users read their own purchases"
  on public.purchases for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own entitlements"
  on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.profiles, public.products, public.product_prices,
  public.purchases, public.entitlements, public.payment_events
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.products, public.product_prices to anon, authenticated;
grant select on public.purchases, public.entitlements to authenticated;

grant all on public.profiles, public.products, public.product_prices,
  public.purchases, public.entitlements, public.payment_events
to service_role;
