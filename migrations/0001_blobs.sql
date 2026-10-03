-- Encrypted sync blobs. The server never sees the sync code or any plaintext:
-- `id` is derived from the code in the browser and `data` is ciphertext.
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  version INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
