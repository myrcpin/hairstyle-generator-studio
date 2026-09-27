-- =============================================================================
-- Starter Pack, post-purchase survey, referrals, and the Business package.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plans & grants: one-time packs and referral months carry "Plus access"
-- -----------------------------------------------------------------------------
alter table public.plans drop constraint plans_kind_check;
alter table public.plans add constraint plans_kind_check check (kind in ('subscription','one_time','business'));
alter table public.plans add column access_days int;           -- one_time: days of Plus features
alter table public.plans add column max_members int;           -- business: staff seats
alter table public.plans add column description text;

insert into public.plans (code, kind, name, generations, alterations, card_builds, grant_days, access_days, description, prices) values
  ('starter_pack', 'one_time', 'Starter Pack', 5, 1, 1, 60, 60,
   'One-off pack: 5 new styles, 1 alteration and 1 full Hairstyle Card.',
   '{"GBP":{"amount":"2.99","paypal_plan_id":null},"USD":{"amount":"4.99","paypal_plan_id":null}}'),
  ('business_studio', 'business', 'Salon', 60, 20, 40, null, null,
   'For independent salons and barbershops: up to 3 staff.',
   '{"GBP":{"amount":"29.00","paypal_plan_id":null},"USD":{"amount":"39.00","paypal_plan_id":null}}'),
  ('business_pro', 'business', 'Salon Pro', 150, 50, 100, null, null,
   'For busy or multi-chair salons: up to 10 staff.',
   '{"GBP":{"amount":"59.00","paypal_plan_id":null},"USD":{"amount":"79.00","paypal_plan_id":null}}');
update public.plans set max_members = 3 where code = 'business_studio';
update public.plans set max_members = 10 where code = 'business_pro';

alter table public.credit_grants add column source text not null default 'purchase'
  check (source in ('purchase','referral','referee_bonus','survey','admin'));
alter table public.credit_grants add column grants_access boolean not null default false;
alter table public.credit_grants add column starts_at timestamptz not null default now();

insert into public.app_settings (key, value) values
  ('referrals', '{"friends_per_reward":3,"max_rewards":3,"reward_days":30,"referee_bonus_generations":1,"qualifying_plans":["starter_pack"],"attach_window_days":14}'),
  ('survey', '{"reward_generations":1,"reward_days":90}');

-- -----------------------------------------------------------------------------
-- Allowance v2: separates "subscribed" from "has Plus access" (sub OR access grant)
-- -----------------------------------------------------------------------------
create or replace function public.get_allowance(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u public.users;
  v_sub boolean;
  v_access_until timestamptz;
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
  v_sub := public.has_paid_access(u);

  select max(expires_at) into v_access_until from public.credit_grants
   where user_id = p_user and grants_access and starts_at <= now() and expires_at > now();

  select coalesce(sum(credits_used),0) into v_free_used from public.usage
   where user_id = p_user and source = 'free' and generation_type = 'generation' and status <> 'refunded';

  if v_sub then
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
    coalesce(sum(greatest(g.generations - coalesce(x.gen,0),0)),0),
    coalesce(sum(greatest(g.alterations - coalesce(x.alt,0),0)),0),
    coalesce(sum(greatest(g.card_builds - coalesce(x.card,0),0)),0)
    into v_grant_gen, v_grant_alt, v_grant_card
    from public.credit_grants g
    left join lateral (
      select
        sum(credits_used) filter (where generation_type='generation') gen,
        sum(credits_used) filter (where generation_type='alteration') alt,
        sum(credits_used) filter (where generation_type='card_build') card
      from public.usage where grant_id = g.id and status <> 'refunded'
    ) x on true
   where g.user_id = p_user and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now());

  return jsonb_build_object(
    'paid', v_sub or v_access_until is not null,
    'subscribed', v_sub,
    'access_until', v_access_until,
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
    'grants', jsonb_build_object('generations', v_grant_gen, 'alterations', v_grant_alt, 'card_builds', v_grant_card),
    'remaining', jsonb_build_object(
      'generations', greatest(v_free_limit - v_free_used,0) + greatest(v_sub_gen_limit - v_sub_gen_used,0) + v_grant_gen,
      'alterations', greatest(v_sub_alt_limit - v_sub_alt_used,0) + v_grant_alt,
      'card_builds', greatest(v_sub_card_limit - v_sub_card_used,0) + v_grant_card)
  );
end $$;

create or replace function public.reserve_usage(p_user uuid, p_project uuid, p_type text, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_existing public.usage;
  v_allow jsonb;
  v_grant uuid;
  v_id uuid;
  v_sub_key text := case p_type when 'generation' then 'generations' when 'alteration' then 'alterations' else 'card_builds' end;
begin
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

  -- earliest-expiring grant first, so nothing is wasted
  select g.id into v_grant from public.credit_grants g
   where g.user_id = p_user and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
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

-- -----------------------------------------------------------------------------
-- Post-purchase survey (5 active questions, admin-editable)
-- -----------------------------------------------------------------------------
create table public.survey_questions (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  prompt     text not null,
  kind       text not null check (kind in ('yes_no','single_choice')),
  options    jsonb not null default '[]'::jsonb,   -- [{"value":"2_4_weeks","label":"Every 2–4 weeks"}]
  active     boolean not null default false,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.survey_questions (key, prompt, kind, options, active, sort) values
  ('cut_frequency', 'How often do you get your hair cut?', 'single_choice',
   '[{"value":"2_4_weeks","label":"Every 2–4 weeks"},{"value":"5_8_weeks","label":"Every 5–8 weeks"},{"value":"2_3_months","label":"Every 2–3 months"},{"value":"less_often","label":"Less often"}]', true, 1),
  ('cut_where', 'Where do you usually get it cut?', 'single_choice',
   '[{"value":"barber","label":"Barber"},{"value":"salon","label":"Salon"},{"value":"home_visit","label":"Mobile / home visit"},{"value":"self","label":"I cut it myself"}]', true, 2),
  ('left_unhappy', 'Have you ever left a haircut unhappy because it wasn''t what you asked for?', 'yes_no', '[]', true, 3),
  ('brings_reference', 'Do you usually show your stylist a photo of what you want?', 'yes_no', '[]', true, 4),
  ('spend_band', 'Roughly how much do you spend on a haircut?', 'single_choice',
   '[{"value":"under_15","label":"Under 15"},{"value":"15_30","label":"15–30"},{"value":"30_60","label":"30–60"},{"value":"over_60","label":"Over 60"}]', true, 5),
  ('same_stylist', 'Do you usually see the same stylist each time?', 'yes_no', '[]', false, 6),
  ('colours_hair', 'Do you colour your hair?', 'yes_no', '[]', false, 7),
  ('main_goal', 'What matters most in your next cut?', 'single_choice',
   '[{"value":"low_maintenance","label":"Easy to look after"},{"value":"professional","label":"Look more professional"},{"value":"new_look","label":"Try something new"},{"value":"fix_problem","label":"Fix something I don''t like"}]', false, 8),
  ('wants_reminder', 'Would you like a reminder when you''re due your next cut?', 'yes_no', '[]', false, 9),
  ('would_book', 'Would you book a recommended stylist near you through us?', 'yes_no', '[]', false, 10);

create table public.survey_responses (
  user_id       uuid not null references public.users(id) on delete cascade,
  question_key  text not null references public.survey_questions(key) on delete cascade,
  answer        text not null check (length(answer) <= 40),
  currency      text,
  created_at    timestamptz not null default now(),
  primary key (user_id, question_key)
);

create table public.survey_completions (
  user_id         uuid primary key references public.users(id) on delete cascade,
  reward_grant_id uuid references public.credit_grants(id) on delete set null,
  completed_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Referrals: 3 friends buy a Starter Pack -> 1 month of Plus, max 3 times
-- -----------------------------------------------------------------------------
create table public.referral_codes (
  user_id    uuid primary key references public.users(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

create table public.referrals (
  id                uuid primary key default gen_random_uuid(),
  referrer_id       uuid not null references public.users(id) on delete cascade,
  referred_user_id  uuid not null unique references public.users(id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending','qualified','rejected')),
  qualified_at      timestamptz,
  created_at        timestamptz not null default now(),
  check (referrer_id <> referred_user_id)
);
create index referrals_referrer_idx on public.referrals(referrer_id, status);

create table public.referral_rewards (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  grant_id    uuid references public.credit_grants(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Called after a qualifying purchase by p_referred. Idempotent; serialised per referrer.
create or replace function public.qualify_referral(p_referred uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from public.app_settings where key = 'referrals'), '{}');
  v_per int := coalesce((cfg->>'friends_per_reward')::int, 3);
  v_max int := coalesce((cfg->>'max_rewards')::int, 3);
  v_days int := coalesce((cfg->>'reward_days')::int, 30);
  v_bonus int := coalesce((cfg->>'referee_bonus_generations')::int, 0);
  v_referrer uuid;
  v_qualified int;
  v_rewards int;
  v_start timestamptz;
  v_grant uuid;
  v_rewarded boolean := false;
begin
  select referrer_id into v_referrer from public.referrals where referred_user_id = p_referred and status = 'pending';
  if v_referrer is null then return jsonb_build_object('qualified', false); end if;
  perform 1 from public.users where id = v_referrer for update;

  update public.referrals set status = 'qualified', qualified_at = now()
   where referred_user_id = p_referred and status = 'pending';
  if not found then return jsonb_build_object('qualified', false); end if;

  if v_bonus > 0 then
    insert into public.credit_grants (user_id, source, generations, expires_at)
    values (p_referred, 'referee_bonus', v_bonus, now() + interval '90 days');
  end if;

  select count(*) into v_qualified from public.referrals where referrer_id = v_referrer and status = 'qualified';
  select count(*) into v_rewards from public.referral_rewards where referrer_id = v_referrer;

  if v_qualified / v_per > v_rewards and v_rewards < v_max then
    -- consecutive months: a new reward month starts when the previous one ends
    select greatest(now(), coalesce(max(expires_at), now())) into v_start
      from public.credit_grants where user_id = v_referrer and source = 'referral';
    insert into public.credit_grants (user_id, source, grants_access, generations, alterations, card_builds, starts_at, expires_at)
    values (v_referrer, 'referral', true,
            public.setting_int('limits','paid_generations',7), public.setting_int('limits','paid_alterations',2),
            public.setting_int('limits','card_builds_per_period',3), v_start, v_start + make_interval(days => v_days))
    returning id into v_grant;
    insert into public.referral_rewards (referrer_id, grant_id) values (v_referrer, v_grant);
    v_rewarded := true;
  end if;

  return jsonb_build_object('qualified', true, 'referrer', v_referrer, 'rewarded', v_rewarded,
                            'qualified_count', v_qualified, 'rewards', v_rewards + case when v_rewarded then 1 else 0 end);
end $$;

-- -----------------------------------------------------------------------------
-- Business: organisations (salons) run client consultations on their own credits
-- -----------------------------------------------------------------------------
create table public.organizations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(name) between 2 and 80),
  slug                    text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  booking_url             text check (booking_url is null or booking_url ~ '^https://'),
  logo_path               text,
  contact_email           text,
  plan_code               text references public.plans(code),
  subscription_status     text not null default 'none'
    check (subscription_status in ('none','pending','active','past_due','suspended','cancelled','expired')),
  paypal_subscription_id  text unique,
  subscription_currency   text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  created_by              uuid references public.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();

create table public.organization_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  role       text not null check (role in ('owner','stylist')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create table public.organization_invites (
  code        text primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null default 'stylist' check (role in ('owner','stylist')),
  created_by  uuid references public.users(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references public.users(id) on delete set null,
  used_at     timestamptz
);

alter table public.projects add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.projects add column client_label text check (client_label is null or length(client_label) <= 60);
create index projects_org_idx on public.projects(org_id, created_at desc);
alter table public.usage add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.usage drop constraint usage_source_check;
alter table public.usage add constraint usage_source_check check (source in ('free','subscription','grant','organization'));
alter table public.payments add column org_id uuid references public.organizations(id) on delete set null;

create or replace function public.is_org_member(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members where org_id = p_org and user_id = p_user);
$$;

create or replace function public.org_active(o public.organizations)
returns boolean language sql stable as $$
  select o.subscription_status = 'active'
      or (o.subscription_status in ('cancelled','past_due') and o.current_period_end is not null and o.current_period_end > now());
$$;

create or replace function public.get_org_allowance(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o public.organizations;
  p public.plans;
  v_start timestamptz;
  v_gen int := 0; v_alt int := 0; v_card int := 0;
begin
  select * into o from public.organizations where id = p_org;
  if not found then return null; end if;
  select * into p from public.plans where code = o.plan_code;
  v_start := coalesce(o.current_period_start, now() - interval '31 days');
  select
    coalesce(sum(credits_used) filter (where generation_type='generation'),0),
    coalesce(sum(credits_used) filter (where generation_type='alteration'),0),
    coalesce(sum(credits_used) filter (where generation_type='card_build'),0)
    into v_gen, v_alt, v_card
    from public.usage where org_id = p_org and status <> 'refunded' and created_at >= v_start;
  return jsonb_build_object(
    'active', public.org_active(o),
    'plan', o.plan_code,
    'max_members', coalesce(p.max_members, 1),
    'members', (select count(*) from public.organization_members where org_id = p_org),
    'period_start', o.current_period_start, 'period_end', o.current_period_end,
    'generations', jsonb_build_object('limit', coalesce(p.generations,0), 'used', v_gen, 'remaining', greatest(coalesce(p.generations,0) - v_gen, 0)),
    'alterations', jsonb_build_object('limit', coalesce(p.alterations,0), 'used', v_alt, 'remaining', greatest(coalesce(p.alterations,0) - v_alt, 0)),
    'card_builds', jsonb_build_object('limit', coalesce(p.card_builds,0), 'used', v_card, 'remaining', greatest(coalesce(p.card_builds,0) - v_card, 0))
  );
end $$;

create or replace function public.reserve_org_usage(p_org uuid, p_user uuid, p_project uuid, p_type text, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_existing public.usage;
  v_allow jsonb;
  v_id uuid;
  v_k text := case p_type when 'generation' then 'generations' when 'alteration' then 'alterations' else 'card_builds' end;
begin
  if not public.is_org_member(p_org, p_user) then raise exception 'forbidden'; end if;
  perform 1 from public.organizations where id = p_org for update;
  select * into v_existing from public.usage where idempotency_key = p_key;
  if found then
    if v_existing.status = 'refunded' then raise exception 'usage_already_refunded'; end if;
    return v_existing.id;
  end if;
  v_allow := public.get_org_allowance(p_org);
  if not (v_allow->>'active')::boolean or (v_allow #>> array[v_k, 'remaining'])::int <= 0 then
    raise exception 'insufficient_credits';
  end if;
  insert into public.usage (user_id, org_id, project_id, generation_type, source, idempotency_key)
  values (p_user, p_org, p_project, p_type, 'organization', p_key) returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Admin summaries
-- -----------------------------------------------------------------------------
create or replace function public.admin_survey_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'completions', (select count(*) from public.survey_completions),
    'eligible', (select count(distinct user_id) from public.payments where status = 'completed' and user_id is not null),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('key', q.key, 'prompt', q.prompt, 'active', q.active,
        'answers', coalesce((select jsonb_object_agg(answer, n) from (select answer, count(*) n from public.survey_responses r where r.question_key = q.key group by answer) a), '{}'))
        order by q.sort)
      from public.survey_questions q), '[]'));
$$;

create or replace function public.admin_growth_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packs_sold', (select count(*) from public.payments where kind = 'one_time' and status = 'completed'),
    'referral_signups', (select count(*) from public.referrals),
    'referrals_qualified', (select count(*) from public.referrals where status = 'qualified'),
    'referral_rewards', (select count(*) from public.referral_rewards),
    'organizations', (select count(*) from public.organizations),
    'organizations_active', (select count(*) from public.organizations o where public.org_active(o)),
    'business_sessions_30d', (select count(*) from public.projects where org_id is not null and created_at > now() - interval '30 days')
  );
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.survey_questions      enable row level security;
alter table public.survey_responses      enable row level security;
alter table public.survey_completions    enable row level security;
alter table public.referral_codes        enable row level security;
alter table public.referrals             enable row level security;
alter table public.referral_rewards      enable row level security;
alter table public.organizations         enable row level security;
alter table public.organization_members  enable row level security;
alter table public.organization_invites  enable row level security;

create policy survey_questions_read on public.survey_questions for select to authenticated using (active);
create policy survey_responses_own on public.survey_responses for select to authenticated using (user_id = auth.uid());
create policy survey_completions_own on public.survey_completions for select to authenticated using (user_id = auth.uid());
create policy referral_codes_own on public.referral_codes for select to authenticated using (user_id = auth.uid());
create policy referral_rewards_own on public.referral_rewards for select to authenticated using (referrer_id = auth.uid());
-- referrers see counts via edge function; the referred user's identity is never exposed to the referrer
create policy orgs_member_read on public.organizations for select to authenticated using (public.is_org_member(id, auth.uid()));
create policy org_members_read on public.organization_members for select to authenticated using (public.is_org_member(org_id, auth.uid()));

-- Staff of a salon can see the salon's client sessions
create policy projects_select_org on public.projects for select to authenticated
  using (org_id is not null and public.is_org_member(org_id, auth.uid()));
create policy generations_select_org on public.generations for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.org_id is not null and public.is_org_member(p.org_id, auth.uid())));
create policy style_cards_select_org on public.style_cards for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.org_id is not null and public.is_org_member(p.org_id, auth.uid())));
grant select (org_id, client_label) on public.projects to authenticated;

revoke execute on function public.qualify_referral(uuid) from public, anon, authenticated;
revoke execute on function public.get_org_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_org_usage(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.admin_survey_summary() from public, anon, authenticated;
revoke execute on function public.admin_growth_stats() from public, anon, authenticated;

-- Public config now includes packs and business plans (prices only; PayPal ids stay private)
create or replace function public.public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'limits', (select value from public.app_settings where key='limits'),
    'referrals', (select value - 'qualifying_plans' - 'attach_window_days' from public.app_settings where key='referrals'),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', code, 'kind', kind, 'name', name, 'description', description,
                'generations', generations, 'alterations', alterations, 'card_builds', card_builds,
                'access_days', access_days, 'max_members', max_members,
                'prices', (select jsonb_object_agg(k, jsonb_build_object('amount', v->'amount')) from jsonb_each(prices) e(k,v)))
                order by kind, created_at), '[]')
              from public.plans where active)
  );
$$;

-- Business logos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('brand', 'brand', false, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
