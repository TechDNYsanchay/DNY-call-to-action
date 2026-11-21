-- Phone calls (2026-11-21), part 4: the Calls list's search by number, matched inside the database. The number
-- lives only in the secret-only call_log; a PostgREST filter would carry it in the URL, and so in the API
-- gateway's request log, while a function call carries it in the request body. Only client and vendor calls that
-- are not deleted are returned (P7), as ids, newest first, at most 100: the list puts them in its own request's
-- URL, which the gateway refuses past 8 KB.

-- F26. Ids of the business calls whose other party's number contains p_digits (7 to 15 digits, as
--      normalizeDigitQuery leaves them); no row for anything else. The server checks the person first.
create or replace function call_ids_by_digits(p_digits text, p_limit integer default 100)
returns table (meeting_id uuid)
language sql stable security invoker set search_path = public as $$
  select m.id
  from call_log c
  join meetings m on m.id = c.meeting_id and m.kind = 'call' and m.type in ('client', 'vendor')
  join phone_calls pc on pc.meeting_id = m.id and pc.purged_at is null
  where p_digits ~ '^[0-9]{7,15}$'
    and strpos(c.counterpart_e164, p_digits) > 0
  order by m.happened_at desc, m.id
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- Secret key only, like every calls function that reads the ledger.
revoke all on function call_ids_by_digits(text, integer) from public, anon, authenticated;
grant execute on function call_ids_by_digits(text, integer) to service_role;
