-- Auto-reply menu topics, v2: adds "I want to book" (QR06) and removes "Payment issue".
-- Order: ticket, price, booking, cancel/refund, talk to team. Safe to run more than once.
update public.whatsapp_auto_reply_settings
set options = (
  select jsonb_agg(item order by ord)
  from (
    select item, case item->>'id' when 'ticket' then 1 when 'price' then 2 when 'refund' then 4 when 'agent' then 5 else 6 end as ord
    from jsonb_array_elements(options) item
    where item->>'id' not in ('payment', 'booking')
    union all
    select $j${"id":"booking","title_ar":"أبي أحجز","title_en":"I want to book","description_ar":"طريقة الحجز في myticket.om","description_en":"How to book on myticket.om","reply_code":"QR06","handoff":false,"tag":"Booking"}$j$::jsonb, 3
  ) t
), updated_at = now()
where id = 1;

select jsonb_array_elements(options)->>'title_ar' as topic from public.whatsapp_auto_reply_settings;
