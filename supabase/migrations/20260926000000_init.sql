-- =============================================================================
-- Hairstyle Card — initial schema
-- Principles:
--   * Every table has RLS enabled. The browser can only READ its own rows.
--   * All writes that affect money, credits or AI generation go through Edge
--     Functions using the service role. The client never writes usage/payments.
--   * Credits are reserved atomically (row lock on the user) and refunded on
--     technical failure.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Settings (admin-configurable, read by edge functions)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.app_settings (key, value) values
  ('limits', '{"free_generations":3,"paid_generations":7,"paid_alterations":2,"card_builds_per_period":3,"max_reference_images":3,"max_upload_mb":10,"min_image_px":512}'),
  ('models', '{"text":"gpt-5-mini","explore":"gpt-image-2.5-flare","final":"gpt-image-2.5-sunburst"}'),
  ('image_quality', '{"free":"medium","paid":"high","alteration":"high","card_view":"medium","size":"1024x1536"}'),
  ('retention', '{"source_image_days":7,"generation_days":30,"saved_project_days":365,"card_days":90,"analytics_days":400}'),
  ('rate_limits', '{"create_project_per_ip_hour":20,"analyse_per_ip_hour":20,"generate_per_user_hour":12,"generate_per_ip_hour":20,"free_accounts_per_ip_30d":3,"email_per_user_day":5,"track_per_ip_minute":120,"public_card_per_ip_minute":60}'),
  ('features', '{"watermark_free":true,"require_email_before_generation":true,"block_disposable_email":true}'),
  ('cost_estimates_usd', '{"text_call":0.003,"image":{"low":0.008,"medium":0.018,"high":0.06,"xhigh":0.1,"max":0.22}}');

-- -----------------------------------------------------------------------------
-- Plans: subscription today, one-time "Style Pack" later without schema change.
-- prices: {"GBP":{"amount":"2.99","paypal_plan_id":"P-..."},"USD":{...}}
-- -----------------------------------------------------------------------------
create table public.plans (
  code         text primary key,
  kind         text not null check (kind in ('subscription','one_time')),
  name         text not null,
  active       boolean not null default true,
  generations  int not null default 0,
  alterations  int not null default 0,
  card_builds  int not null default 0,
  prices       jsonb not null default '{}'::jsonb,
  grant_days   int,               -- one_time packs: how long granted credits last
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

insert into public.plans (code, kind, name, generations, alterations, card_builds, prices) values
  ('plus_monthly', 'subscription', 'Plus', 7, 2, 3,
   '{"GBP":{"amount":"2.99","paypal_plan_id":null},"USD":{"amount":"3.99","paypal_plan_id":null}}');

-- -----------------------------------------------------------------------------
-- Users (profile mirror of auth.users; written by triggers + service role only)
-- -----------------------------------------------------------------------------
create table public.users (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text,
  created_at              timestamptz not null default now(),
  email_verified          boolean not null default false,
  subscription_status     text not null default 'none'
    check (subscription_status in ('none','pending','active','past_due','suspended','cancelled','expired')),
  subscription_plan       text references public.plans(code),
  paypal_customer_id      text,
  paypal_subscription_id  text unique,
  subscription_currency   text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  is_admin                boolean not null default false,
  first_ip_hash           text,
  device_hash             text,
  updated_at              timestamptz not null default now()
);

create or replace function public.handle_auth_user_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, email_verified)
  values (new.id, new.email, new.email_confirmed_at is not null)
  on conflict (id) do update
    set email = excluded.email,
        email_verified = excluded.email_verified,
        updated_at = now();
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_auth_user_change();
create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_auth_user_change();

-- -----------------------------------------------------------------------------
-- Projects and inputs
-- -----------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  status           text not null default 'draft'
    check (status in ('draft','analysing','ready','rejected','generating','complete','expired')),
  brief            jsonb,
  recommendations  jsonb,
  rejection_reason text,
  saved            boolean not null default false,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days'
);
create index projects_user_idx on public.projects(user_id, created_at desc);
create index projects_expires_idx on public.projects(expires_at);

create table public.source_images (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  storage_path     text not null unique,
  type             text not null check (type in ('selfie','reference')),
  content_type     text not null,
  width            int,
  height           int,
  uploaded         boolean not null default false,
  rights_confirmed boolean not null default false,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '7 days'
);
create index source_images_project_idx on public.source_images(project_id);
create index source_images_expires_idx on public.source_images(expires_at);

create table public.style_requests (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  description         text,
  current_length      text check (current_length in ('very_short','short','medium','long')),
  preferred_length    text check (preferred_length in ('keep_similar','slightly_shorter','much_shorter','grow_longer','not_sure')),
  preferred_texture   text,
  maintenance_level   text check (maintenance_level in ('very_low','low','moderate','high')),
  professional_level  text[],   -- style direction: professional, natural, classic, modern, relaxed, bold
  colour_preference   text check (colour_preference in ('keep_current','slight_change','new_colour','no_preference')),
  reference_image_id  uuid references public.source_images(id) on delete set null,
  request_hash        text,
  created_at          timestamptz not null default now()
);
create index style_requests_project_idx on public.style_requests(project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Usage ledger (credits). Reserved -> consumed | refunded.
-- -----------------------------------------------------------------------------
create table public.credit_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  plan_code    text references public.plans(code),
  payment_id   uuid,
  generations  int not null default 0,
  alterations  int not null default 0,
  card_builds  int not null default 0,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index credit_grants_user_idx on public.credit_grants(user_id);

create table public.usage (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  generation_type  text not null check (generation_type in ('generation','alteration','card_build')),
  credits_used     int not null default 1 check (credits_used > 0),
  status           text not null default 'reserved' check (status in ('reserved','consumed','refunded')),
  source           text not null check (source in ('free','subscription','grant')),
  grant_id         uuid references public.credit_grants(id) on delete set null,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index usage_user_idx on public.usage(user_id, generation_type, created_at);

-- -----------------------------------------------------------------------------
-- Generations
-- -----------------------------------------------------------------------------
create table public.generations (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  parent_generation_id  uuid references public.generations(id) on delete set null,
  generation_type       text not null check (generation_type in ('concept','alteration','card_view')),
  direction             text,     -- conservative | balanced | substantial | extra
  view                  text not null default 'front' check (view in ('front','three_quarter','side','back','tied_back')),
  recommendation        jsonb,
  instruction           text,
  prompt_version        text not null,
  prompt                text,
  model                 text not null,
  quality               text not null,
  size                  text not null,
  status                text not null default 'queued' check (status in ('queued','processing','succeeded','failed','cancelled')),
  storage_path          text,
  error_message         text,     -- human-readable only; never raw provider errors
  error_code            text,
  attempts              int not null default 0,
  usage_id              uuid references public.usage(id) on delete set null,
  idempotency_key       text not null unique,
  cost_estimate_usd     numeric(10,4),
  concept_only          boolean not null default false,
  created_at            timestamptz not null default now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  expires_at            timestamptz not null default now() + interval '30 days'
);
create index generations_project_idx on public.generations(project_id, created_at);
create index generations_status_idx on public.generations(status, created_at);
create index generations_expires_idx on public.generations(expires_at);

-- -----------------------------------------------------------------------------
-- Hairstyle Cards
-- -----------------------------------------------------------------------------
create table public.style_cards (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  user_id                 uuid not null references public.users(id) on delete cascade,
  selected_generation_id  uuid not null references public.generations(id) on delete cascade,
  tier                    text not null default 'preview' check (tier in ('preview','full')),
  status                  text not null default 'building' check (status in ('building','ready','failed')),
  public_token            text unique,
  card_data               jsonb not null default '{}'::jsonb,
  qr_code_path            text,
  build_usage_id          uuid references public.usage(id) on delete set null,
  share_original          boolean not null default false,
  view_count              int not null default 0,
  revoked_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '90 days',
  unique (selected_generation_id)
);
create index style_cards_user_idx on public.style_cards(user_id);

-- -----------------------------------------------------------------------------
-- Payments + webhook idempotency
-- -----------------------------------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete set null,
  paypal_event_id  text,
  transaction_id   text unique,
  subscription_id  text,
  plan_code        text references public.plans(code),
  kind             text not null default 'subscription' check (kind in ('subscription','one_time')),
  amount           numeric(10,2),
  currency         text,
  status           text not null,   -- completed | failed | refunded | reversed | pending
  created_at       timestamptz not null default now()
);
create index payments_user_idx on public.payments(user_id, created_at desc);

create table public.paypal_events (
  event_id      text primary key,
  event_type    text not null,
  resource_id   text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  attempts      int not null default 0,
  last_error    text
);

-- -----------------------------------------------------------------------------
-- Analytics (no IPs, no emails, no free text)
-- -----------------------------------------------------------------------------
create table public.analytics_events (
  id          bigint generated always as identity primary key,
  event       text not null,
  user_id     uuid references public.users(id) on delete set null,
  anon_id     text,
  project_id  uuid,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index analytics_event_idx on public.analytics_events(event, created_at);

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window counters, keys contain hashed IPs only)
-- -----------------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);

create or replace function public.consume_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end $$;

-- -----------------------------------------------------------------------------
-- Settings helper
-- -----------------------------------------------------------------------------
create or replace function public.setting_int(p_key text, p_field text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> p_field)::int from public.app_settings where key = p_key), p_default);
$$;

-- -----------------------------------------------------------------------------
-- Entitlements
-- -----------------------------------------------------------------------------
create or replace function public.has_paid_access(u public.users)
returns boolean language sql stable as $$
  select u.subscription_status = 'active'
      or (u.subscription_status in ('cancelled','past_due') and u.current_period_end is not null and u.current_period_end > now());
$$;

-- Returns the full allowance picture for a user. Server-side source of truth.
create or replace function public.get_allowance(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u public.users;
  v_paid boolean;
  v_plan public.plans;
  v_period_start timestamptz;
  v_free_limit int := public.setting_int('limits','free_generations',3);
  v_free_used int;
  v_sub_gen_limit int := 0; v_sub_alt_limit int := 0; v_sub_card_limit int := 0;
  v_sub_gen_used int := 0;  v_sub_alt_used int := 0;  v_sub_card_used int := 0;
  v_grant_gen int := 0; v_grant_alt int := 0; v_grant_card int := 0;
begin
  select * into u from public.users where id = p_user;
  if not found then return null; end if;
  v_paid := public.has_paid_access(u);

  select coalesce(sum(credits_used),0) into v_free_used from public.usage
   where user_id = p_user and source = 'free' and generation_type = 'generation' and status <> 'refunded';

  if v_paid then
    select * into v_plan from public.plans where code = coalesce(u.subscription_plan,'plus_monthly');
    v_period_start := coalesce(u.current_period_start, now() - interval '31 days');
    v_sub_gen_limit  := public.setting_int('limits','paid_generations', coalesce(v_plan.generations,7));
    v_sub_alt_limit  := public.setting_int('limits','paid_alterations', coalesce(v_plan.alterations,2));
    v_sub_card_limit := public.setting_int('limits','card_builds_per_period', coalesce(v_plan.card_builds,3));
    select
      coalesce(sum(credits_used) filter (where generation_type='generation'),0),
      coalesce(sum(credits_used) filter (where generation_type='alteration'),0),
      coalesce(sum(credits_used) filter (where generation_type='card_build'),0)
      into v_sub_gen_used, v_sub_alt_used, v_sub_card_used
      from public.usage
     where user_id = p_user and source = 'subscription' and status <> 'refunded' and created_at >= v_period_start;
  end if;

  select
    coalesce(sum(g.generations - coalesce(x.gen,0)),0),
    coalesce(sum(g.alterations - coalesce(x.alt,0)),0),
    coalesce(sum(g.card_builds - coalesce(x.card,0)),0)
    into v_grant_gen, v_grant_alt, v_grant_card
    from public.credit_grants g
    left join lateral (
      select
        sum(credits_used) filter (where generation_type='generation') gen,
        sum(credits_used) filter (where generation_type='alteration') alt,
        sum(credits_used) filter (where generation_type='card_build') card
      from public.usage where grant_id = g.id and status <> 'refunded'
    ) x on true
   where g.user_id = p_user and (g.expires_at is null or g.expires_at > now());

  return jsonb_build_object(
    'paid', v_paid,
    'subscription_status', u.subscription_status,
    'plan', u.subscription_plan,
    'period_start', u.current_period_start,
    'period_end', u.current_period_end,
    'email_verified', u.email_verified,
    'free', jsonb_build_object('limit', v_free_limit, 'used', v_free_used, 'remaining', greatest(v_free_limit - v_free_used, 0)),
    'subscription', jsonb_build_object(
      'generations', jsonb_build_object('limit', v_sub_gen_limit, 'used', v_sub_gen_used, 'remaining', greatest(v_sub_gen_limit - v_sub_gen_used,0)),
      'alterations', jsonb_build_object('limit', v_sub_alt_limit, 'used', v_sub_alt_used, 'remaining', greatest(v_sub_alt_limit - v_sub_alt_used,0)),
      'card_builds', jsonb_build_object('limit', v_sub_card_limit, 'used', v_sub_card_used, 'remaining', greatest(v_sub_card_limit - v_sub_card_used,0))),
    'grants', jsonb_build_object('generations', greatest(v_grant_gen,0), 'alterations', greatest(v_grant_alt,0), 'card_builds', greatest(v_grant_card,0)),
    'remaining', jsonb_build_object(
      'generations', greatest(v_free_limit - v_free_used,0) + greatest(v_sub_gen_limit - v_sub_gen_used,0) + greatest(v_grant_gen,0),
      'alterations', greatest(v_sub_alt_limit - v_sub_alt_used,0) + greatest(v_grant_alt,0),
      'card_builds', greatest(v_sub_card_limit - v_sub_card_used,0) + greatest(v_grant_card,0))
  );
end $$;

-- Atomically reserves one unit of credit. Idempotent on p_key.
-- Order of consumption: subscription -> one-time grants -> free (generations only).
-- Raises 'insufficient_credits' when nothing is left.
create or replace function public.reserve_usage(p_user uuid, p_project uuid, p_type text, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_existing public.usage;
  v_allow jsonb;
  v_grant uuid;
  v_id uuid;
  v_sub_key text := case p_type when 'generation' then 'generations' when 'alteration' then 'alterations' else 'card_builds' end;
begin
  -- serialise all reservations for this user
  perform 1 from public.users where id = p_user for update;
  if not found then raise exception 'unknown_user'; end if;

  select * into v_existing from public.usage where idempotency_key = p_key;
  if found then
    if v_existing.status = 'refunded' then raise exception 'usage_already_refunded'; end if;
    return v_existing.id;
  end if;

  v_allow := public.get_allowance(p_user);

  if (v_allow #>> array['subscription', v_sub_key, 'remaining'])::int > 0 then
    insert into public.usage (user_id, project_id, generation_type, source, idempotency_key)
    values (p_user, p_project, p_type, 'subscription', p_key) returning id into v_id;
    return v_id;
  end if;

  select g.id into v_grant from public.credit_grants g
   where g.user_id = p_user and (g.expires_at is null or g.expires_at > now())
     and (case p_type when 'generation' then g.generations when 'alteration' then g.alterations else g.card_builds end)
         > (select count(*) from public.usage x where x.grant_id = g.id and x.generation_type = p_type and x.status <> 'refunded')
   order by g.expires_at nulls last, g.created_at
   limit 1;
  if v_grant is not null then
    insert into public.usage (user_id, project_id, generation_type, source, grant_id, idempotency_key)
    values (p_user, p_project, p_type, 'grant', v_grant, p_key) returning id into v_id;
    return v_id;
  end if;

  if p_type = 'generation' and (v_allow #>> '{free,remaining}')::int > 0 then
    insert into public.usage (user_id, project_id, generation_type, source, idempotency_key)
    values (p_user, p_project, p_type, 'free', p_key) returning id into v_id;
    return v_id;
  end if;

  raise exception 'insufficient_credits';
end $$;

create or replace function public.finalize_usage(p_usage uuid, p_success boolean)
returns void language sql security definer set search_path = public as $$
  update public.usage
     set status = case when p_success then 'consumed' else 'refunded' end, updated_at = now()
   where id = p_usage and status = 'reserved';
$$;

-- Admin stats in one round-trip
create or replace function public.admin_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users_total',        (select count(*) from public.users where email is not null),
    'users_anonymous',    (select count(*) from public.users where email is null),
    'users_paid',         (select count(*) from public.users u where public.has_paid_access(u)),
    'users_free',         (select count(*) from public.users u where email is not null and not public.has_paid_access(u)),
    'subscriptions',      (select coalesce(jsonb_object_agg(subscription_status, n),'{}') from (select subscription_status, count(*) n from public.users group by 1) s),
    'generations',        (select count(*) from public.generations where generation_type='concept' and status='succeeded'),
    'alterations',        (select count(*) from public.generations where generation_type='alteration' and status='succeeded'),
    'card_views',         (select count(*) from public.generations where generation_type='card_view' and status='succeeded'),
    'generation_failures',(select count(*) from public.generations where status='failed'),
    'api_cost_usd',       (select coalesce(sum(cost_estimate_usd),0) from public.generations where status='succeeded'),
    'api_cost_usd_30d',   (select coalesce(sum(cost_estimate_usd),0) from public.generations where status='succeeded' and created_at > now() - interval '30 days'),
    'revenue',            (select coalesce(jsonb_object_agg(currency, total),'{}') from (select currency, sum(amount) total from public.payments where status='completed' group by 1) r),
    'revenue_30d',        (select coalesce(jsonb_object_agg(currency, total),'{}') from (select currency, sum(amount) total from public.payments where status='completed' and created_at > now() - interval '30 days' group by 1) r),
    'conversion_rate',    (select case when count(*) filter (where email is not null) = 0 then 0
                                  else round(count(*) filter (where paypal_subscription_id is not null and subscription_status <> 'pending')::numeric
                                             / count(*) filter (where email is not null), 4) end from public.users),
    'avg_generations_per_user', (select coalesce(round(avg(n),2),0) from (select count(*) n from public.generations where generation_type in ('concept','alteration') and status='succeeded' group by user_id) g),
    'cards',              (select count(*) from public.style_cards),
    'storage_bytes',      (select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id in ('uploads','generations','cards')),
    'storage_objects',    (select count(*) from storage.objects where bucket_id in ('uploads','generations','cards')),
    'funnel_30d',         (select coalesce(jsonb_object_agg(event, n),'{}') from (select event, count(*) n from public.analytics_events where created_at > now() - interval '30 days' group by 1) f)
  );
$$;

-- Public, non-sensitive configuration for the landing/pricing pages
create or replace function public.public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'limits', (select value from public.app_settings where key='limits'),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', code, 'kind', kind, 'name', name,
                'generations', generations, 'alterations', alterations, 'card_builds', card_builds,
                'prices', (select jsonb_object_agg(k, jsonb_build_object('amount', v->'amount')) from jsonb_each(prices) e(k,v)))), '[]')
              from public.plans where active)
  );
$$;

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger style_cards_touch before update on public.style_cards for each row execute function public.touch_updated_at();
create trigger users_touch before update on public.users for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.app_settings     enable row level security;
alter table public.plans            enable row level security;
alter table public.users            enable row level security;
alter table public.projects         enable row level security;
alter table public.source_images    enable row level security;
alter table public.style_requests   enable row level security;
alter table public.usage            enable row level security;
alter table public.credit_grants    enable row level security;
alter table public.generations      enable row level security;
alter table public.style_cards      enable row level security;
alter table public.payments         enable row level security;
alter table public.paypal_events    enable row level security;
alter table public.analytics_events enable row level security;
alter table public.rate_limits      enable row level security;

-- Read-own policies. No insert/update/delete policies: all writes go through
-- edge functions with the service role, which bypasses RLS.
create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
create policy projects_select_own on public.projects for select to authenticated using (user_id = auth.uid());
create policy source_images_select_own on public.source_images for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy style_requests_select_own on public.style_requests for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy generations_select_own on public.generations for select to authenticated using (user_id = auth.uid());
create policy style_cards_select_own on public.style_cards for select to authenticated using (user_id = auth.uid());
create policy usage_select_own on public.usage for select to authenticated using (user_id = auth.uid());
create policy credit_grants_select_own on public.credit_grants for select to authenticated using (user_id = auth.uid());
create policy payments_select_own on public.payments for select to authenticated using (user_id = auth.uid());

-- Column-level hardening: hide internal columns from the browser.
revoke select on public.users from anon, authenticated;
grant select (id, email, created_at, email_verified, subscription_status, subscription_plan,
              current_period_start, current_period_end, is_admin) on public.users to authenticated;
revoke select on public.generations from anon, authenticated;
grant select (id, project_id, user_id, parent_generation_id, generation_type, direction, view, recommendation,
              instruction, model, quality, status, error_message, error_code, concept_only, created_at, completed_at, expires_at)
  on public.generations to authenticated;
revoke select on public.projects from anon, authenticated;
grant select (id, user_id, status, brief, recommendations, rejection_reason, saved, created_at, updated_at, expires_at)
  on public.projects to authenticated;

-- Functions: only the service role may call the credit/ratelimit/admin functions.
revoke execute on function public.consume_rate_limit(text,int,int) from public, anon, authenticated;
revoke execute on function public.reserve_usage(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.finalize_usage(uuid,boolean) from public, anon, authenticated;
revoke execute on function public.admin_stats() from public, anon, authenticated;
revoke execute on function public.get_allowance(uuid) from public, anon, authenticated;
grant execute on function public.public_config() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Storage: private buckets. No storage policies => only the service role can
-- read/write; the browser uploads through signed upload URLs and reads through
-- short-lived signed URLs issued by edge functions.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('generations', 'generations', false, 20971520, array['image/jpeg','image/png','image/webp']),
  ('cards', 'cards', false, 5242880, array['image/png','image/svg+xml'])
on conflict (id) do nothing;
