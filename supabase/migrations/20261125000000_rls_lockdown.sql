-- Security fix (Supabase alert "Table publicly accessible / rls_disabled_in_public").
-- The browser's public key could read, change and delete tables without Row-Level Security.
-- The inbox server uses the service-role key, which is not affected by RLS, so the app keeps working.
-- The browser only needs to READ three tables for live updates (realtime), and only for signed-in agents.
-- Safe to run more than once. Run in Supabase -> SQL Editor.

-- 1) "Is the signed-in user an active inbox agent?" (security definer, so it can check whatsapp_agents under RLS)
create or replace function public.is_inbox_agent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.whatsapp_agents a where a.auth_user_id = auth.uid() and coalesce(a.is_active, true))
$$;
revoke all on function public.is_inbox_agent() from public, anon;
grant execute on function public.is_inbox_agent() to authenticated;

-- 2) Turn RLS on for every table in the public schema that still has it off.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS turned on: %', t.relname;
  end loop;
end $$;

-- 3) Live updates: signed-in agents may read messages, conversations and internal notes. Nobody else, and no writes.
do $$
declare t text;
begin
  foreach t in array array['whatsapp_messages', 'whatsapp_conversations', 'whatsapp_internal_notes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "inbox agents can read" on public.%I', t);
      execute format('create policy "inbox agents can read" on public.%I for select to authenticated using (public.is_inbox_agent())', t);
    end if;
  end loop;
end $$;

-- Check: every public table should now show rls_on = true.
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by rls_on, table_name;
