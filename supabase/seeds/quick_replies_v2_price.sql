-- Quick Replies v2: QR16 "Price" (Arabic + English). Smart Reply suggests it for "كم تذكرة؟" / "how much?".
-- Safe to run more than once. Run in Supabase -> SQL Editor.
begin;

insert into saved_replies (title, body, created_by)
select v.title, v.body, (select id from whatsapp_agents where role = 'admin' and is_active limit 1)
from (values
  ($r$QR16-AR | السعر$r$, $r$أهلاً بك 🧡
الأسعار تختلف حسب الفعالية أو التجربة، وتقدر تشوفها في صفحتها على myticket.om.
أرسل لنا اسم الفعالية أو التجربة اللي تبيها، وبنرسل لك السعر والمواعيد المتاحة.$r$),
  ($r$QR16-EN | Price$r$, $r$Hello 🧡
Prices depend on the event or experience, and you can see them on its page at myticket.om.
Send us the name of the event or experience you’re interested in, and we’ll share the price and available dates.$r$)
) as v(title, body)
where not exists (select 1 from saved_replies s where s.title = v.title and s.is_active);

commit;

select title, left(body, 40) as starts_with from saved_replies where is_active and title like 'QR16%' order by title;
