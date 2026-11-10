-- Minimal, bounded diagnostics. No free-form error messages, URL queries or form data.
create table if not exists public.client_issues (
 id uuid primary key, employee_id uuid not null references public.employees(id), at timestamptz not null default now(),
 kind text not null check(kind in ('render','error','promise')), code text not null check(code in ('Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AggregateError')),
 route text not null check(length(route)<=120 and route ~ '^/[a-z0-9/\[\]:-]*$'),
 location text not null check(length(location)<=240), build text not null check(length(build)<=40)
);
alter table public.client_issues enable row level security;
create index if not exists client_issues_at on public.client_issues(at);
create or replace function public.report_client_issue(p_id uuid,p_kind text,p_code text,p_route text,p_location text,p_build text) returns void
language plpgsql security definer set search_path=public as $$
declare who uuid:=public.current_employee_id();begin
 if who is null or not exists(select 1 from public.employees where id=who and is_active and deleted_at is null) then raise exception 'not_allowed' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('m2-client-issues'));
 delete from public.client_issues where at<now()-interval '30 days';
 if exists(select 1 from public.client_issues where id=p_id) then return;end if;
 if (select count(*) from public.client_issues where employee_id=who and at>now()-interval '1 hour')>=10 then raise exception 'rate_limit';end if;
 if p_location !~ '^(/assets/[A-Za-z0-9_-]+\.js:[0-9]+:[0-9]+ ?){0,3}$' or p_build !~ '^[A-Za-z0-9:.+_-]{0,40}$' then raise exception 'invalid_diagnostic';end if;
 delete from public.client_issues where id in (select id from public.client_issues order by at desc offset 9999);
 insert into public.client_issues(id,employee_id,kind,code,route,location,build) values(p_id,who,p_kind,p_code,p_route,p_location,p_build);
end $$;
create or replace function public.recent_client_issues() returns table(id uuid,at timestamptz,kind text,code text,route text,location text,build text,who text)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 return query select i.id,i.at,i.kind,i.code,i.route,i.location,i.build,e.full_name from public.client_issues i join public.employees e on e.id=i.employee_id where i.at>now()-interval '30 days' order by i.at desc limit 200;
end $$;
revoke all on public.client_issues from anon,authenticated;
revoke execute on function public.report_client_issue(uuid,text,text,text,text,text),public.recent_client_issues() from public,anon;
grant execute on function public.report_client_issue(uuid,text,text,text,text,text),public.recent_client_issues() to authenticated;
notify pgrst,'reload schema';
