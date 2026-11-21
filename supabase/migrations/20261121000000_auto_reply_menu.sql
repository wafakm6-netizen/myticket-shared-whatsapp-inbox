-- Auto-reply menu: when nobody answers a customer within a minute, WhatsApp sends a tappable list of topics.
-- The customer's choice gets the matching approved quick reply (or is handed to the team) and tags the chat.
-- Starts switched OFF. Safe to run more than once. Run in Supabase -> SQL Editor.

create table if not exists public.whatsapp_auto_reply_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  delay_seconds int not null default 60 check (delay_seconds between 30 and 3600),
  cooldown_hours int not null default 12 check (cooldown_hours between 1 and 168),
  intro_ar text not null,
  intro_en text not null,
  button_ar text not null default 'اختر الموضوع',
  button_en text not null default 'Choose a topic',
  handoff_ar text not null,
  handoff_en text not null,
  options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.whatsapp_agents(id) on delete set null
);

insert into public.whatsapp_auto_reply_settings (id, enabled, intro_ar, intro_en, handoff_ar, handoff_en, options)
values (1, false,
  $t$أهلاً بك في myticket.om 🧡
فريقنا بيرد عليك في أقرب وقت. وعشان نخدمك أسرع، اختر موضوع رسالتك:$t$,
  $t$Welcome to myticket.om 🧡
Our team will reply shortly. To help us serve you faster, please choose a topic:$t$,
  $t$تمام 🧡 وصلت رسالتك لفريق الدعم، وبيتابع معك موظف في أقرب وقت.$t$,
  $t$Thank you 🧡 Your message is with our support team, and someone will follow up with you shortly.$t$,
  $j$[
    {"id":"ticket","title_ar":"التذكرة ما وصلتني","title_en":"Ticket not received","description_ar":"ما لقيت التذكرة في الإيميل أو في تذاكري","description_en":"Not in my email or My Tickets","reply_code":"QR02","handoff":false,"tag":"Ticket not received"},
    {"id":"price","title_ar":"أسعار ومواعيد","title_en":"Prices & dates","description_ar":"سعر فعالية أو تجربة ومواعيدها","description_en":"Price and dates of an event or experience","reply_code":"QR16","handoff":false,"tag":"Price & dates"},
    {"id":"payment","title_ar":"مشكلة في الدفع","title_en":"Payment issue","description_ar":"انخصم المبلغ وما وصلت التذكرة","description_en":"Charged but no ticket","reply_code":null,"handoff":true,"tag":"Payment issue"},
    {"id":"refund","title_ar":"إلغاء أو استرداد","title_en":"Cancel or refund","description_ar":"إلغاء حجز أو استرجاع مبلغ","description_en":"Cancel a booking or get money back","reply_code":null,"handoff":true,"tag":"Cancel / refund"},
    {"id":"agent","title_ar":"أبي أكلم موظف","title_en":"Talk to our team","description_ar":"موضوع ثاني","description_en":"Something else","reply_code":null,"handoff":true,"tag":"Wants an agent"}
  ]$j$::jsonb)
on conflict (id) do nothing;

-- One row per automatic message, so a customer never gets the menu twice for the same message or within the cooldown.
create table if not exists public.whatsapp_auto_reply_log (
  id bigserial primary key,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  trigger_external_id text not null,
  kind text not null check (kind in ('menu', 'answer')),
  option_id text,
  external_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists whatsapp_auto_reply_log_once on public.whatsapp_auto_reply_log (trigger_external_id, kind);
create index if not exists whatsapp_auto_reply_log_recent on public.whatsapp_auto_reply_log (conversation_id, created_at desc);

-- Only the server (service role) reads and writes these tables.
alter table public.whatsapp_auto_reply_settings enable row level security;
alter table public.whatsapp_auto_reply_log enable row level security;

select enabled, delay_seconds, jsonb_array_length(options) as options from public.whatsapp_auto_reply_settings;
