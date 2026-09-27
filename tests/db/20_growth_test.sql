\set ON_ERROR_STOP on
\o /dev/null
-- Starter Pack access, referrals (3 friends -> 1 month, max 3), business credits. Runs after 10_credits_test.
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.mkuser(n int) returns uuid language plpgsql as $$
declare v uuid := ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
begin insert into auth.users (id, email, email_confirmed_at) values (v, 'u' || n || '@example.com', now()); return v; end $$;

-- 1. Starter Pack grant gives Plus access + 5/1/1 credits, not a subscription
select pg_temp.mkuser(100);
insert into public.credit_grants (user_id, plan_code, source, grants_access, generations, alterations, card_builds, expires_at)
values ('20000000-0000-0000-0000-000000000100', 'starter_pack', 'purchase', true, 5, 1, 1, now() + interval '60 days');
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000100') ->> 'paid')::boolean, 'pack gives access');
select pg_temp.assert(not (public.get_allowance('20000000-0000-0000-0000-000000000100') ->> 'subscribed')::boolean, 'pack is not a subscription');
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000100') #>> '{remaining,generations}')::int = 8, '3 free + 5 pack');
select public.reserve_usage('20000000-0000-0000-0000-000000000100', null, 'alteration', 'pack-alt-1');
do $$ begin
  perform public.reserve_usage('20000000-0000-0000-0000-000000000100', null, 'alteration', 'pack-alt-2');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'insufficient_credits' then raise; end if; end $$;
-- a future-dated grant is not usable yet
insert into public.credit_grants (user_id, source, generations, starts_at, expires_at)
values ('20000000-0000-0000-0000-000000000100', 'admin', 50, now() + interval '1 day', now() + interval '2 days');
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000100') #>> '{grants,generations}')::int = 5, 'future grant ignored');

-- 2. Referrals: referrer R, friends F1..F10
select pg_temp.mkuser(200);
select pg_temp.mkuser(200 + i) from generate_series(1, 10) i;
insert into public.referrals (referrer_id, referred_user_id)
select '20000000-0000-0000-0000-000000000200', ('20000000-0000-0000-0000-' || lpad((200 + i)::text, 12, '0'))::uuid from generate_series(1, 10) i;

select public.qualify_referral('20000000-0000-0000-0000-000000000201');
select public.qualify_referral('20000000-0000-0000-0000-000000000202');
select pg_temp.assert((select count(*) from public.referral_rewards) = 0, 'no reward at 2/3');
select pg_temp.assert(not (public.get_allowance('20000000-0000-0000-0000-000000000200') ->> 'paid')::boolean, 'no access yet');
-- referee bonus for the friend
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000201') #>> '{grants,generations}')::int = 1, 'friend gets bonus style');
select pg_temp.assert(((public.qualify_referral('20000000-0000-0000-0000-000000000203')) ->> 'rewarded')::boolean, 'reward at 3/3');
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000200') ->> 'paid')::boolean, 'referrer has Plus access');
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000200') #>> '{grants,generations}')::int = 7, 'month allowance');
-- idempotent: qualifying the same friend twice does nothing
select pg_temp.assert(not ((public.qualify_referral('20000000-0000-0000-0000-000000000203')) ->> 'qualified')::boolean, 'idempotent');
-- 6 more -> rewards 2 and 3, second month starts when first ends
select public.qualify_referral(('20000000-0000-0000-0000-' || lpad((200 + i)::text, 12, '0'))::uuid) from generate_series(4, 9) i;
select pg_temp.assert((select count(*) from public.referral_rewards) = 3, 'three rewards');
select pg_temp.assert((select count(*) from public.credit_grants where source='referral' and starts_at > now() + interval '29 days') = 2, 'later months are consecutive, not overlapping');
-- 10th friend: capped at 3 rewards
select public.qualify_referral('20000000-0000-0000-0000-000000000210');
select pg_temp.assert((select count(*) from public.referral_rewards) = 3, 'max 3 rewards');
-- self-referral impossible
do $$ begin
  insert into public.referrals (referrer_id, referred_user_id) values ('20000000-0000-0000-0000-000000000100', '20000000-0000-0000-0000-000000000100');
  raise exception 'should have failed';
exception when check_violation then null; end $$;

-- 3. Business: org credits are separate from personal credits, members only
select pg_temp.mkuser(300);
select pg_temp.mkuser(301);
insert into public.organizations (id, name, slug, plan_code, subscription_status, current_period_start, current_period_end)
values ('30000000-0000-0000-0000-000000000001', 'Test Salon', 'test-salon', 'business_studio', 'active', now() - interval '1 day', now() + interval '29 days');
insert into public.organization_members (org_id, user_id, role) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000300', 'owner');
select public.reserve_org_usage('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000300', null, 'generation', 'org-g-' || i) from generate_series(1, 60) i;
do $$ begin
  perform public.reserve_org_usage('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000300', null, 'generation', 'org-g-61');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'insufficient_credits' then raise; end if; end $$;
select pg_temp.assert((public.get_allowance('20000000-0000-0000-0000-000000000300') #>> '{free,remaining}')::int = 3, 'personal credits untouched');
do $$ begin
  perform public.reserve_org_usage('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000301', null, 'generation', 'org-x');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'forbidden' then raise; end if; end $$;
update public.organizations set subscription_status = 'suspended' where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.reserve_org_usage('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000300', null, 'alteration', 'org-a');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'insufficient_credits' then raise; end if; end $$;

-- 4. RLS: salon staff see salon sessions, outsiders don't
insert into public.projects (id, user_id, org_id) values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000300', '30000000-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000301', false);
select pg_temp.assert((select count(*) from public.projects where id = '40000000-0000-0000-0000-000000000001') = 0, 'outsider cannot see salon session');
select pg_temp.assert((select count(*) from public.organizations) = 0, 'outsider cannot see org');
select pg_temp.assert((select count(*) from public.referrals) = 0, 'referrals not readable by clients');
reset role;
insert into public.organization_members (org_id, user_id, role) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000301', 'stylist');
set role authenticated;
select pg_temp.assert((select count(*) from public.projects where id = '40000000-0000-0000-0000-000000000001') = 1, 'stylist sees salon session');
select pg_temp.assert((select count(*) from public.survey_questions) = 5, 'five active survey questions');
reset role;

select pg_temp.assert((public.admin_growth_stats() ->> 'referral_rewards')::int = 3, 'growth stats');
select pg_temp.assert(jsonb_array_length(public.admin_survey_summary() -> 'questions') = 10, 'survey summary');
\echo 'ALL GROWTH DB TESTS PASSED'
