CREATE TABLE preferences (
  user_id    BIGINT      NOT NULL PRIMARY KEY REFERENCES users(id),
  preference TEXT
);
