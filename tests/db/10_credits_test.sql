\set ON_ERROR_STOP on
\o /dev/null
-- Plain-SQL assertions for credit accounting, entitlements and RLS.
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- 1. auth trigger mirrors users
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', null);
select pg_temp.assert((select count(*) from public.users where id='00000000-0000-0000-0000-000000000001') = 1, 'anon user mirrored');
update auth.users set email='a@example.com', email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000001';
select pg_temp.assert((select email_verified from public.users where id='00000000-0000-0000-0000-000000000001'), 'email verified synced');

insert into public.projects (id, user_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');

-- 2. free user: exactly 3 generations, no alterations
select public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k1');
select public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k2');
-- idempotent: same key does not consume again
select public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k2');
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') #>> '{free,remaining}')::int = 1, 'free remaining 1 after 2 unique reservations');
select public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k3');
do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k4');
  raise exception 'should have failed';
exception when others then
  if sqlerrm <> 'insufficient_credits' then raise; end if;
end $$;

-- 3. failed generation refunds the credit
select public.finalize_usage((select id from public.usage where idempotency_key='k3'), false);
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') #>> '{free,remaining}')::int = 1, 'refund restores credit');
-- a refunded key cannot be silently reused
do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','generation','k3');
  raise exception 'should have failed';
exception when others then
  if sqlerrm <> 'usage_already_refunded' then raise; end if;
end $$;
select public.finalize_usage((select id from public.usage where idempotency_key='k1'), true);
select pg_temp.assert((select status from public.usage where idempotency_key='k1') = 'consumed', 'consumed');
-- finalize is one-shot: a consumed credit cannot be refunded later
select public.finalize_usage((select id from public.usage where idempotency_key='k1'), false);
select pg_temp.assert((select status from public.usage where idempotency_key='k1') = 'consumed', 'finalize idempotent');

do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','alteration','a0');
  raise exception 'should have failed';
exception when others then
  if sqlerrm <> 'insufficient_credits' then raise; end if;
end $$;

-- 4. paid user: 7 generations + 2 alterations per period, consumed before free
update public.users set subscription_status='active', subscription_plan='plus_monthly',
  current_period_start = now() - interval '1 day', current_period_end = now() + interval '29 days'
 where id='00000000-0000-0000-0000-000000000001';
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') #>> '{subscription,generations,remaining}')::int = 7, 'paid 7');
select public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'generation', 'p'||i) from generate_series(1,7) i;
select pg_temp.assert((select source from public.usage where idempotency_key='p1') = 'subscription', 'subscription consumed first');
-- 8th paid generation falls back to the one leftover free credit, 9th fails
select public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'generation', 'p8');
select pg_temp.assert((select source from public.usage where idempotency_key='p8') = 'free', 'leftover free used after subscription');
do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'generation', 'p9');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'insufficient_credits' then raise; end if; end $$;
select public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'alteration', 'alt'||i) from generate_series(1,2) i;
do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'alteration', 'alt3');
  raise exception 'should have failed';
exception when others then if sqlerrm <> 'insufficient_credits' then raise; end if; end $$;

-- 5. renewal: new period resets subscription usage
update public.users set current_period_start = now() + interval '1 second' where id='00000000-0000-0000-0000-000000000001';
select pg_sleep(1.1);
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') #>> '{subscription,generations,remaining}')::int = 7, 'renewal resets');

-- 6. cancelled keeps access until period end; suspended loses it
update public.users set subscription_status='cancelled' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') ->> 'paid')::boolean, 'cancelled keeps access until period end');
update public.users set subscription_status='suspended' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.assert(not (public.get_allowance('00000000-0000-0000-0000-000000000001') ->> 'paid')::boolean, 'suspended loses access');

-- 7. one-time grant (future Style Pack) is spendable
insert into public.credit_grants (user_id, generations, alterations) values ('00000000-0000-0000-0000-000000000001', 2, 1);
select public.reserve_usage('00000000-0000-0000-0000-000000000001', null, 'generation', 'g1');
select pg_temp.assert((select source from public.usage where idempotency_key='g1') = 'grant', 'grant used');
select pg_temp.assert((public.get_allowance('00000000-0000-0000-0000-000000000001') #>> '{grants,generations}')::int = 1, 'grant decremented');

-- 8. rate limit
select pg_temp.assert(public.consume_rate_limit('t', 60, 2), 'rl 1');
select pg_temp.assert(public.consume_rate_limit('t', 60, 2), 'rl 2');
select pg_temp.assert(not public.consume_rate_limit('t', 60, 2), 'rl 3 blocked');

-- 9. RLS: a second user cannot see the first user's data; browser cannot call credit functions
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000002', 'b@example.com', now());
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.assert((select count(*) from public.projects) = 0, 'rls hides other projects');
select pg_temp.assert((select count(*) from public.usage) = 0, 'rls hides other usage');
select pg_temp.assert((select count(*) from public.users) = 1, 'sees only own user row');
do $$ begin
  perform public.reserve_usage('00000000-0000-0000-0000-000000000002', null, 'generation', 'x');
  raise exception 'should have failed';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.users set subscription_status='active' where id = '00000000-0000-0000-0000-000000000002';
  if (select subscription_status from public.users where id='00000000-0000-0000-0000-000000000002') = 'active' then
    raise exception 'user escalated own subscription';
  end if;
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.assert((select count(*) from public.projects) = 1, 'owner sees own project');
select pg_temp.assert(public.public_config() ? 'plans', 'public config callable');
reset role;

select pg_temp.assert((public.admin_stats() ->> 'users_total')::int = 2, 'admin stats');
\echo 'ALL DB TESTS PASSED'
