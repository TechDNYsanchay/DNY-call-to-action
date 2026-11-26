-- Tarique, 26 Nov: switch on Kaushalya Patil's line (first seen in Callyzer today at 13:56 IST), analysed from
-- the start of today so her calls since then are included. Client and vendor calls get a sheet, as on the other
-- client-work lines. Switching it on from Settings would analyse from now instead.
update phone_lines
   set enabled = true,
       enabled_at = coalesce(enabled_at, now()),
       analyse_from = '2026-11-26 00:00:00+05:30'
 where callyzer_name = 'Kaushalya Patil'
   and not enabled;
