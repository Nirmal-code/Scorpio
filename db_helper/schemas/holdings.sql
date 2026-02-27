CREATE TABLE holdings (
  user_id      BIGINT         NOT NULL REFERENCES users(id),
  ticker       VARCHAR(32)    NOT NULL,
  quantity     DOUBLE PRECISION NOT NULL,
  avg_cost     DOUBLE PRECISION NOT NULL,
  market_value DOUBLE PRECISION NOT NULL,
  book_value   DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (ticker, user_id)
);
