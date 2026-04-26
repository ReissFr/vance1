-- Phase 5.2: Add WhatsApp as a notification channel.
-- Twilio routes WhatsApp through the same Messages API; we differentiate by
-- prefixing From/To with `whatsapp:` in the Twilio lib. Here we just widen
-- the channel check constraint so rows can be inserted with channel='whatsapp'.

alter table public.notifications
  drop constraint if exists notifications_channel_check;
alter table public.notifications
  add constraint notifications_channel_check
    check (channel in ('sms','call','whatsapp'));

alter table public.inbound_messages
  drop constraint if exists inbound_messages_channel_check;
alter table public.inbound_messages
  add constraint inbound_messages_channel_check
    check (channel in ('sms','call','whatsapp'));
