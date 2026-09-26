-- Run once in the SQL editor after deploying functions (replace the two placeholders).
-- Schedules the retention/recovery job hourly using pg_cron + pg_net.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/maintenance', 'maintenance_url');
select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select cron.schedule('hairstyle-maintenance', '7 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_url'),
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
