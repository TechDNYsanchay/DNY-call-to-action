-- Tarique, 21 Nov: switch the support line on, analysed from 19 Nov, so the next wide read (today and the
-- two days before) picks up its recorded calls from the last three days. Applied after the code that writes
-- up its sales enquiries is live; switching it on from Settings would analyse from now instead.
update phone_lines
   set enabled = true,
       enabled_at = coalesce(enabled_at, now()),
       analyse_from = '2026-11-19 00:00:00+05:30'
 where callyzer_name = 'support';
