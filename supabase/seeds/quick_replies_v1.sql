-- Quick Replies catalog: 15 intents x Arabic/English (30 shared saved replies).
-- Safe to run more than once: skips any title that already exists and is active.
-- Run in Supabase -> SQL Editor. Review the result with the SELECT at the end.
begin;

-- Retire the old missing-ticket reply (typo, and said "orders"); QR02 replaces it. Kept, not deleted.
update saved_replies set is_active = false, updated_at = now()
where is_active and lower(title) in ('not recieving ticket in email', 'not receiving ticket in email');

insert into saved_replies (title, body, created_by)
select v.title, v.body, (select id from whatsapp_agents where role = 'admin' and is_active limit 1)
from (values
  ($r$QR01-AR | ترحيب$r$, $r$مرحباً بك في myticket.om 🧡
يسعدنا مساعدتك! كيف نقدر نخدمك اليوم؟$r$),
  ($r$QR01-EN | Welcome$r$, $r$Welcome to myticket.om 🧡
We’re happy to help! How can we assist you today?$r$),
  ($r$QR02-AR | التذكرة لم تصل$r$, $r$نعتذر إذا ما وصلتك التذكرة 🧡
تقدر تدخل حسابك في myticket.om وتراجع قسم تذاكري. وإذا ما ظهرت، أرسل لنا رقم الحجز أو البريد الإلكتروني المستخدم وبنساعدك.$r$),
  ($r$QR02-EN | Ticket Not Received$r$, $r$Sorry you haven’t received your ticket 🧡
You can log in to myticket.om and check My Tickets. If it’s not there, please share your booking number or the email you used, and we’ll help.$r$),
  ($r$QR03-AR | انخصم المبلغ ولم تصل التذكرة$r$, $r$نعتذر عن الإرباك. إذا انخصم المبلغ وما ظهرت التذكرة، أرسل لنا رقم الحجز إن وجد، ووقت الدفع، وآخر 4 أرقام من البطاقة فقط. بنتحقق من العملية ونرجع لك بالتحديث.$r$),
  ($r$QR03-EN | Payment Deducted, No Ticket$r$, $r$Sorry for the inconvenience. If you were charged but didn’t receive a ticket, please share your booking number (if available), the payment time, and only the last 4 digits of your card. We’ll investigate and update you.$r$),
  ($r$QR04-AR | خصم مكرر$r$, $r$نعتذر عن الخصم المكرر. أرسل لنا رقم الحجز وصورة العمليتين مع إخفاء بيانات البطاقة الحساسة، وبنراجع الحالة مع فريق المدفوعات.$r$),
  ($r$QR04-EN | Duplicate Charge$r$, $r$We’re sorry about the duplicate charge. Please send your booking number and screenshots of both transactions, hiding any sensitive card details. Our payments team will review the case.$r$),
  ($r$QR05-AR | تأكيد الحجز$r$, $r$شكراً لحجزك عبر myticket.om 🧡
تقدر تشوف تفاصيل حجزك وتذكرتك من قسم تذاكري. نتمنى لك تجربة جميلة!$r$),
  ($r$QR05-EN | Booking Confirmation$r$, $r$Thank you for booking with myticket.om 🧡
You can find your booking details and ticket under My Tickets. Enjoy your experience!$r$),
  ($r$QR06-AR | طريقة الحجز$r$, $r$الحجز سهل! 🧡
ادخل myticket.om، اختر التجربة المناسبة، حدد الموعد وعدد الأشخاص، وأكمل الدفع. بعدها تلقى تذكرتك في حسابك.$r$),
  ($r$QR06-EN | How to Book$r$, $r$Booking is easy! 🧡
Visit myticket.om, choose your experience, select the date and number of guests, and complete payment. Your ticket will then be available in your account.$r$),
  ($r$QR07-AR | تغيير موعد الحجز$r$, $r$حاب تغيّر موعد حجزك؟ أرسل لنا رقم الحجز والموعد الجديد المطلوب، وبنتحقق من إمكانية التغيير حسب شروط التجربة وتوفر المواعيد.$r$),
  ($r$QR07-EN | Change Booking$r$, $r$Need to change your booking date? Please share your booking number and your preferred new date. We’ll check availability and the experience’s change policy.$r$),
  ($r$QR08-AR | الإلغاء والاسترداد$r$, $r$نتفهّم طلبك 🧡
أرسل لنا رقم الحجز وسبب الإلغاء، وبنراجع شروط الإلغاء والاسترداد الخاصة بالتجربة ونوضح لك الخيارات المتاحة.$r$),
  ($r$QR08-EN | Cancellation & Refund$r$, $r$We understand 🧡
Please share your booking number and the reason for cancelling. We’ll review the experience’s cancellation and refund policy and explain your options.$r$),
  ($r$QR09-AR | حالة الاسترداد$r$, $r$شكراً على متابعتك. أرسل لنا رقم الحجز أو رقم طلب الاسترداد، وبنتحقق من آخر تحديث لحالتك.$r$),
  ($r$QR09-EN | Refund Status$r$, $r$Thank you for following up. Please share your booking number or refund request reference, and we’ll check the latest status.$r$),
  ($r$QR10-AR | الموقع والاتجاهات$r$, $r$أكيد! 🧡
أرسل لنا اسم التجربة أو رقم الحجز، وبنساعدك في الوصول لموقعها وتفاصيل الطريق.$r$),
  ($r$QR10-EN | Location & Directions$r$, $r$Of course! 🧡
Please share the experience name or booking number, and we’ll help you with its location and directions.$r$),
  ($r$QR11-AR | مسح تذكرة QR$r$, $r$عند وصولك، جهّز رمز QR الموجود في تذكرتك واعرضه على الموظف المسؤول ليمسحه ويتحقق من الحجز. نتمنى لك وقتاً ممتعاً!$r$),
  ($r$QR11-EN | QR Ticket Scanning$r$, $r$When you arrive, please have the QR code on your ticket ready for staff to scan and validate your booking. Enjoy!$r$),
  ($r$QR12-AR | توفر التجربة$r$, $r$يسعدنا نساعدك 🧡
أرسل لنا اسم التجربة والتاريخ وعدد الأشخاص، وبنتحقق لك من المواعيد المتاحة.$r$),
  ($r$QR12-EN | Experience Availability$r$, $r$Happy to help 🧡
Please share the experience name, preferred date, and number of guests, and we’ll check availability.$r$),
  ($r$QR13-AR | مشكلة تقنية$r$, $r$نعتذر عن المشكلة التقنية. ممكن ترسل لنا صورة للخطأ، ونوع جهازك، والخطوة اللي ظهرت فيها المشكلة؟ بنحوّل التفاصيل للفريق المختص.$r$),
  ($r$QR13-EN | Technical Issue$r$, $r$Sorry about the technical issue. Could you share a screenshot of the error, your device type, and the step where it happened? We’ll pass the details to our technical team.$r$),
  ($r$QR14-AR | الانضمام كشريك$r$, $r$يسعدنا انضمامك لشركاء myticket.om 🧡
تقدر تقدم طلب الشراكة من الرابط:
https://myticket.om/ar/partners
وفريقنا بيتواصل معك لمناقشة التفاصيل.$r$),
  ($r$QR14-EN | Become a Partner$r$, $r$We’d love to welcome you as a myticket.om partner 🧡
Apply here:
https://myticket.om/en/partners
Our team will follow up to discuss the details.$r$),
  ($r$QR15-AR | إنهاء المحادثة$r$, $r$سعدنا بخدمتك 🧡
شكراً لاختيارك myticket.om، ونتمنى نشوفك في تجربة جديدة قريباً!$r$),
  ($r$QR15-EN | Closing Conversation$r$, $r$It was a pleasure assisting you 🧡
Thank you for choosing myticket.om. We hope to see you on another experience soon!$r$)
) as v(title, body)
where not exists (select 1 from saved_replies s where s.title = v.title and s.is_active);

commit;

select title, left(body, 40) as starts_with from saved_replies where is_active and title like 'QR%' order by title;
