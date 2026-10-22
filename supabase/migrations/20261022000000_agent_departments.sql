create table if not exists public.whatsapp_agent_departments (
 agent_id uuid not null references public.whatsapp_agents(id) on delete cascade,
 department text not null check (department in ('customer_support','supplier_relations','booking_operations')),
 primary key (agent_id,department)
);
alter table public.whatsapp_agent_departments enable row level security;
revoke all on public.whatsapp_agent_departments from anon,authenticated;
create index if not exists whatsapp_agent_departments_department_idx on public.whatsapp_agent_departments(department);
