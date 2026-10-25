-- Permit Team as a WhatsApp contact classification.
-- Preserve the existing column type and any unrelated constraints.
DO $$
DECLARE
  existing_type text;
  c record;
BEGIN
  SELECT data_type INTO existing_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'whatsapp_contacts' AND column_name = 'contact_type';

  IF existing_type = 'USER-DEFINED' THEN
    RAISE EXCEPTION 'contact_type uses an enum; inspect and extend the enum before applying this migration';
  END IF;

  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_contacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%contact_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.whatsapp_contacts DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.whatsapp_contacts
    ADD CONSTRAINT whatsapp_contacts_contact_type_allowed
    CHECK (contact_type IN ('customer', 'supplier', 'team'));
END $$;
