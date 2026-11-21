-- Lines whose sales enquiries also get a sheet (2026-11-21, Tarique). On such a line, a call the routine
-- confidently classifies as a sales enquiry is written up like a client call, with the prospect as the client
-- side, instead of being deleted. Personal, internal, wrong-number and empty calls are still deleted, and an
-- unsure answer still waits for a person.
alter table phone_lines add column sales_get_sheets boolean not null default false;
grant select (sales_get_sheets) on phone_lines to authenticated;

-- Tarique, 21 Nov: the support line's enquiries get CTAs. The line itself is switched on by the next
-- migration, once the code that reads this column is live.
update phone_lines set sales_get_sheets = true where callyzer_name = 'support';
