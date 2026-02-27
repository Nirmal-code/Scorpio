CREATE TABLE runs (
  id   BIGINT        UNIQUE NOT NULL,
  user_id  BIGINT        NOT NULL REFERENCES users(id),
  summary  TEXT,
  PRIMARY KEY (id, user_id)
);