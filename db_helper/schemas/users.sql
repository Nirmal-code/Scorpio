CREATE TABLE users (
  id                BIGINT        NOT NULL PRIMARY KEY,
  wealthsimple_email VARCHAR(255) NOT NULL,
  fname             VARCHAR(100)  NOT NULL,
  lname             VARCHAR(100)  NOT NULL
);