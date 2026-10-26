-- Driver presentation details that OpenF1's `drivers` endpoint returns and the
-- ingester previously dropped (DECISIONS.md D24). All nullable: older sessions
-- and rows ingested before this migration have no values until `drivers` is
-- re-ingested (`--refresh=drivers`). `team_colour` is stored as OpenF1 sends it
-- (six hex digits, no '#'); the API adds the '#'. `headshot_url` is a source
-- URL only; images are never stored or proxied.
ALTER TABLE driver
    ADD COLUMN headshot_url   text,
    ADD COLUMN team_colour    text,
    ADD COLUMN first_name     text,
    ADD COLUMN last_name      text,
    ADD COLUMN broadcast_name text,
    ADD COLUMN country_code   text;
