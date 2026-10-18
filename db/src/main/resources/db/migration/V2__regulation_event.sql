-- Values come from docs/regulations.md (issue number and article cited there).
-- No FIA limit is hard-coded anywhere else (AGENTS.md truth rules).
CREATE TABLE regulation_event (
    session_key           int PRIMARY KEY,
    issue_in_force        smallint NOT NULL,
    race_recharge_mj      numeric,
    quali_recharge_mj     numeric,
    derate_rate_kw_per_s  smallint,
    limit_known           boolean NOT NULL
);
COMMENT ON TABLE regulation_event IS 'Per-event FIA energy limits; values come from docs/regulations.md.';
