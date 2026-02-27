CREATE TABLE ticker_summary (
  run_id   BIGINT        NOT NULL REFERENCES runs(id),
  user_id  BIGINT        NOT NULL REFERENCES users(id),
  ticker   VARCHAR(32)   NOT NULL,
  summary  TEXT,
  PRIMARY KEY (run_id, ticker)
);
