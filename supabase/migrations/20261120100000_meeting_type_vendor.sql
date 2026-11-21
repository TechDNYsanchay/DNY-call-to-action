-- Phone calls (2026-11-20), part 1 of 2: the 'vendor' conversation type. A call with a supplier gets a
-- sheet like a client call; in that sheet the "client" side means the vendor. Its own file because a new
-- enum value can only be used after the transaction that adds it has committed, and part 2 uses it.
alter type meeting_type add value if not exists 'vendor' after 'internal';
