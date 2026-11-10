-- =====================================================================
--  نظام مخيم 2: التحديث 31 · SMS من اشتراك الشركة (هوت SMS)
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- The office's SMS go out from the company's subscription, sent by the database itself (the «http»
-- add-on), so the login never reaches a phone or the code. The manager types the login once in
-- Settings; it is kept in m2_ops (out of the app's reach) and is never read back.

do $$
begin
  -- Supabase has it; a bare test database may not (sending then answers «network»).
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create schema if not exists extensions;
    create extension if not exists http with schema extensions;
  end if;
end $$;
create schema if not exists m2_ops;
revoke all on schema m2_ops from public;

create table if not exists m2_ops.sms_config (
  id integer primary key default 1 check (id = 1),
  user_name text,
  user_pass text,
  sender text not null default 'AF Camp2',
  updated_at timestamptz not null default now()
);

-- One call to the provider; returns what it answered (1001 = sent, 1000 = no balance, 2000 = login…).
create or replace function m2_ops.hotsms(p_page text, p_params jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg m2_ops.sms_config;
  res record;
begin
  select * into cfg from m2_ops.sms_config where id = 1;
  if cfg.user_name is null or cfg.user_pass is null then return 'no_login'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');
  select status, content into res
    from extensions.http_get('https://hotsms.ps/' || p_page,
      p_params || jsonb_build_object('user_name', cfg.user_name, 'user_pass', cfg.user_pass));
  if res.status is distinct from 200 then return 'http_' || coalesce(res.status::text, '0'); end if;
  return btrim(coalesce(res.content, ''), E' \r\n\t');
exception when others then
  return 'network';
end $$;
revoke all on function m2_ops.hotsms(text, jsonb) from public;

-- The manager saves the login (an empty password keeps the old one). Nothing ever reads it back.
create or replace function public.sms_set_login(p_user text, p_pass text, p_sender text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into m2_ops.sms_config (id, user_name, user_pass, sender)
  values (1, nullif(btrim(p_user), ''), nullif(p_pass, ''), coalesce(nullif(btrim(p_sender), ''), 'AF Camp2'))
  on conflict (id) do update set
    user_name = coalesce(nullif(btrim(p_user), ''), m2_ops.sms_config.user_name),
    user_pass = coalesce(nullif(p_pass, ''), m2_ops.sms_config.user_pass),
    sender = coalesce(nullif(btrim(p_sender), ''), m2_ops.sms_config.sender),
    updated_at = now();
end $$;

-- Is it set up (and with which sender name)? The balance comes with it when asked.
create or replace function public.sms_info(p_balance boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg m2_ops.sms_config;
begin
  if not (public.is_manager() or public.has_page('tasks')) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into cfg from m2_ops.sms_config where id = 1;
  return jsonb_build_object(
    'ready', cfg.user_name is not null and cfg.user_pass is not null,
    'user', case when public.is_manager() then cfg.user_name end,
    'sender', coalesce(cfg.sender, 'AF Camp2'),
    'balance', case when p_balance and cfg.user_name is not null then m2_ops.hotsms('getbalance.php', '{}'::jsonb) end
  );
end $$;

-- Sends one text to a few numbers (05xxxxxxxx) from the company's subscription; each is logged.
-- A task's order marks the task sent only when the provider took it.
create or replace function public.sms_send(p_phones text[], p_text text, p_task uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg m2_ops.sms_config;
  ph text;
  code text;
  ok boolean;
  sent integer := 0;
  failed jsonb := '[]'::jsonb;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'empty_text'; end if;
  if length(p_text) > 335 then raise exception 'too_long'; end if;
  if coalesce(array_length(p_phones, 1), 0) = 0 or array_length(p_phones, 1) > 5 then raise exception 'bad_count'; end if;
  select * into cfg from m2_ops.sms_config where id = 1;
  foreach ph in array p_phones loop
    if ph !~ '^05[0-9]{8}$' then
      failed := failed || jsonb_build_object('phone', ph, 'code', '5000');
      continue;
    end if;
    code := m2_ops.hotsms('sendbulksms.php', jsonb_build_object(
      'sender', coalesce(cfg.sender, 'AF Camp2'), 'mobile', '972' || substr(ph, 2), 'type', '2', 'text', p_text));
    ok := code like '1001%';
    insert into public.outgoing_messages (task_id, channel, to_phone, body, status, provider, provider_ref, error, sent_at)
    values (p_task, 'sms', ph, p_text, case when ok then 'sent' else 'failed' end::public.message_status,
            'hotsms', code, case when ok then null else code end, case when ok then now() end);
    if ok then sent := sent + 1; else failed := failed || jsonb_build_object('phone', ph, 'code', code); end if;
  end loop;
  return jsonb_build_object('sent', sent, 'failed', failed);
end $$;

-- Logging a send marks the task sent, unless the provider refused it.
create or replace function public.outgoing_message_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.current_employee_id(), new.created_by);
  if new.task_id is not null and new.status is distinct from 'failed' then
    insert into public.task_events (task_id, event, actor_id, meta)
      values (new.task_id, case new.channel when 'sms' then 'sent_sms' else 'sent_whatsapp' end, new.created_by,
              jsonb_build_object('to', new.to_phone, 'via', coalesce(new.provider, 'phone')));
    update public.tasks set status = 'sent' where id = new.task_id and status = 'new';
  end if;
  return new;
end $$;

revoke execute on function public.sms_set_login(text, text, text), public.sms_info(boolean), public.sms_send(text[], text, uuid) from anon, public;
grant execute on function public.sms_set_login(text, text, text), public.sms_info(boolean), public.sms_send(text[], text, uuid) to authenticated;

notify pgrst, 'reload schema';
