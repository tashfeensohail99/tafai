-- Click-to-WhatsApp ad attribution.
--
-- Meta sends a `referral` block on the FIRST inbound message after a
-- customer clicks a WhatsApp ad on Facebook / Instagram. Subsequent
-- messages on the same thread don't carry it, so we persist:
--
--   * On the thread: the most recent referral the contact engaged via,
--     so the inbox UI can show "this contact replied through <ad>"
--     even on later messages. Overwritten if they click a different
--     ad later — adReferralAt records the most recent attribution.
--
--   * On the message: the exact referral that triggered THIS reply, so
--     we can ledger which message a given ad produced (useful for
--     campaign reporting and for showing the ad inline above the
--     specific message that came from it).
--
-- JSONB so we keep the full Meta payload (headline, body, media_type,
-- image_url, video_url, thumbnail_url, source_url, source_id,
-- source_type, ctwa_clid) without committing to a column-per-field
-- schema that we'd have to re-migrate every time Meta extends it.

ALTER TABLE "whatsapp"."threads"
  ADD COLUMN "adReferral"   JSONB,
  ADD COLUMN "adReferralAt" TIMESTAMP(3);

ALTER TABLE "whatsapp"."messages"
  ADD COLUMN "adReferral" JSONB;
