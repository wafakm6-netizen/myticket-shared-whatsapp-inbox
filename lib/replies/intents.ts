// Smart Reply, rule-based (no AI): reads the customer's latest message, finds the topic from approved Arabic/English
// keywords, and points to the matching approved quick reply (QR01–QR15). It never writes text of its own, so it cannot
// promise a refund, a payment or availability: the agent always reviews the reply and presses Send.

export type Intent =
  | 'duplicate_charge' | 'payment_deducted' | 'refund_status' | 'cancellation' | 'change_date' | 'ticket_missing'
  | 'qr_scan' | 'location' | 'availability' | 'booking_help' | 'technical_issue' | 'partnership' | 'welcome' | 'closing'

type Rule = { intent: Intent; code: string; label: { ar: string; en: string }; ar: RegExp[]; en: RegExp[] }

// Order matters only for ties: money topics first.
const RULES: Rule[] = [
  { intent: 'duplicate_charge', code: 'QR04', label: { ar: 'خصم مكرر', en: 'Duplicate charge' },
    ar: [/مكرر/, /مرتين/, /خصم(وا)? (مني )?مرتين/, /انخصم.*مرتين/, /عمليتين/], en: [/duplicate/, /charged twice/, /double charg/, /two charges/, /twice/] },
  { intent: 'payment_deducted', code: 'QR03', label: { ar: 'انخصم المبلغ', en: 'Payment deducted' },
    ar: [/انخصم/, /خصم(وا)?/, /سحب(وا)? المبلغ/, /دفعت/, /تم الدفع/, /انسحب/, /المبلغ/], en: [/charged/, /deducted/, /paid but/, /payment (went|was taken)/, /money (was )?taken/] },
  { intent: 'refund_status', code: 'QR09', label: { ar: 'حالة الاسترداد', en: 'Refund status' },
    ar: [/وين (فلوسي|المبلغ)/, /متي (يرجع|ترجع|بيرجع)/, /(حاله|وضع) الاسترداد/, /رجعو(ا)? المبلغ/, /ما رجع المبلغ/, /طلب الاسترداد/], en: [/refund status/, /where is my refund/, /my refund/, /refund (yet|still)/, /(when|haven.?t).*refund/] },
  { intent: 'cancellation', code: 'QR08', label: { ar: 'إلغاء واسترداد', en: 'Cancellation' },
    ar: [/الغاء/, /الغي/, /نلغي/, /كنسل/, /استرداد/, /استرجاع/, /ارجاع (المبلغ|الفلوس)/], en: [/cancel/, /refund/, /money back/] },
  { intent: 'change_date', code: 'QR07', label: { ar: 'تغيير الموعد', en: 'Change date' },
    ar: [/تغيير (الموعد|التاريخ|الوقت|الحجز)/, /اغير/, /نغير/, /تاجيل/, /اجل/, /موعد (ثاني|اخر)/, /يوم (ثاني|اخر)/, /تعديل (الحجز|الموعد)/], en: [/change (the |my )?(date|time|booking)/, /reschedul/, /another (date|day|time)/, /move my booking/, /postpone/] },
  { intent: 'ticket_missing', code: 'QR02', label: { ar: 'التذكرة ما وصلت', en: 'Ticket not received' },
    ar: [/ما ?وصل(ت|تني|ني)/, /لم (تصل|يصل)/, /ما ?جا(تني|ني|ت)/, /وين (التذكره|تذكرتي|التذاكر)/, /ما (لقيت|حصلت) (التذكره|تذكرتي)/, /التذكره/, /تذكرتي/], en: [/(didn.?t|did not|haven.?t|have not|not) (get|got|receive)/, /not received/, /no ticket/, /where.*ticket/, /ticket.*(email|missing)/] },
  { intent: 'qr_scan', code: 'QR11', label: { ar: 'مسح تذكرة QR', en: 'QR scanning' },
    ar: [/\bqr\b/i, /باركود/, /الباركود/, /مسح (التذكره|الكود)/, /الكود/, /عند الدخول/, /البوابه/], en: [/\bqr\b/, /barcode/, /scan/, /at the (gate|entrance)/, /entry/] },
  { intent: 'location', code: 'QR10', label: { ar: 'الموقع', en: 'Location' },
    ar: [/موقع/, /لوكيشن/, /وين (المكان|مكانها|مكانه|الفعاليه|التجربه)/, /الطريق/, /العنوان/, /خريطه/, /كيف (اوصل|نوصل)/], en: [/location/, /where is (it|the)/, /address/, /directions/, /\bmap\b/, /how (do|can) (i|we) get/] },
  { intent: 'availability', code: 'QR12', label: { ar: 'توفر المواعيد', en: 'Availability' },
    ar: [/متوفر/, /متاح/, /(في|فيه) (مكان|اماكن|مقاعد)/, /المواعيد/, /التواريخ/, /فاضي/, /باقي (تذاكر|اماكن)/], en: [/availab/, /slots?\b/, /open dates/, /spots? left/, /any (seats|places|tickets)/] },
  { intent: 'booking_help', code: 'QR06', label: { ar: 'طريقة الحجز', en: 'How to book' },
    ar: [/كيف (احجز|نحجز|الحجز)/, /طريقه الحجز/, /(ابغي|ابي|ودي|حاب) (احجز|نحجز)/, /ابغي حجز/], en: [/how (do|can) (i|we) book/, /how to book/, /(want|like) to book/, /make a booking/] },
  { intent: 'technical_issue', code: 'QR13', label: { ar: 'مشكلة تقنية', en: 'Technical issue' },
    ar: [/خطا/, /مشكله/, /ما ?يفتح/, /عطل/, /ما ?يشتغل/, /علق/, /ما ?قدرت (ادخل|اسجل|ادفع)/, /التطبيق/], en: [/error/, /\bbug\b/, /not working/, /crash/, /can.?t (log ?in|sign in|pay|open)/, /won.?t load/, /\bissue\b/, /problem/] },
  { intent: 'partnership', code: 'QR14', label: { ar: 'شراكة', en: 'Partnership' },
    ar: [/شراكه/, /شريك/, /نتعاون/, /تعاون/, /(اضيف|اعرض|ننزل) (نشاطي|تجربتي|فعاليتي|خدماتي)/, /مزود/], en: [/partner/, /collaborat/, /list (my|our)/, /vendor/, /supplier/, /work with you/] },
  { intent: 'closing', code: 'QR15', label: { ar: 'شكر وإنهاء', en: 'Closing' },
    ar: [/^(شكرا|مشكور|مشكورين|يعطيك العافيه|تسلم|الله يعطيك العافيه|ثانكس)/], en: [/^(thanks|thank you|thx|great,? thanks)/] },
  { intent: 'welcome', code: 'QR01', label: { ar: 'ترحيب', en: 'Welcome' },
    ar: [/^(السلام|سلام|مرحبا|هلا|اهلا|صباح|مساء|هاي)/], en: [/^(hi|hello|hey|good (morning|afternoon|evening)|salam)\b/] },
]

// Fold Arabic spelling variants so "إلغاء", "الغاء" and "ألغي" match the same rule.
export function normalize(text: string) {
  return text.toLowerCase()
    .replace(/[ً-ْـ]/g, '') // diacritics and tatweel
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

export function detectLanguage(text: string): 'ar' | 'en' {
  const arabic = (text.match(/[؀-ۿ]/g) || []).length
  const latin = (text.match(/[a-zA-Z]/g) || []).length
  return arabic >= latin ? 'ar' : 'en'
}

export type Suggestion = { intent: Intent; code: string; label: string; evidence: string }

// Up to `limit` topics, best first. Greetings and thanks only count when nothing else matched.
export function suggestIntents(message: string, limit = 3): { language: 'ar' | 'en'; suggestions: Suggestion[] } {
  const language = detectLanguage(message)
  const text = normalize(message)
  const scored: (Suggestion & { score: number; order: number })[] = []
  RULES.forEach((rule, order) => {
    let score = 0, evidence = ''
    for (const pattern of [...rule.ar, ...rule.en]) {
      const match = text.match(pattern)
      if (match) { score += 1; if (!evidence) evidence = match[0] }
    }
    if (score) scored.push({ intent: rule.intent, code: rule.code, label: rule.label[language], evidence, score, order })
  })
  const specific = scored.filter((s) => s.intent !== 'welcome' && s.intent !== 'closing')
  // "Cancellation" also matches the word refund; when a refund status question is clear, prefer it.
  const pool = (specific.length ? specific : scored).filter((s, _, all) => !(s.intent === 'cancellation' && all.some((o) => o.intent === 'refund_status') && !/(الغاء|الغي|كنسل|cancel)/.test(text)))
  pool.sort((a, b) => b.score - a.score || a.order - b.order)
  return { language, suggestions: pool.slice(0, limit).map(({ score, order, ...rest }) => rest) }
}
