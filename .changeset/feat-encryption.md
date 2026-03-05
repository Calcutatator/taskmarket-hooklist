---
'@lucid-agents/taskmarket': minor
'@taskmarket/backend': patch
---

feat(encryption): add ECIES file encryption/decryption using wallet keys

New commands:
- `taskmarket encrypt <file> [--recipient <address>] [--output <path>]` — encrypts a file using ECIES on secp256k1; defaults to self-encryption
- `taskmarket decrypt <file> [--output <path>]` — decrypts a file using your wallet private key
- `taskmarket wallet publish-key` — publishes your compressed secp256k1 public key to the backend so others can encrypt files for you

Backend changes:
- DB migration `0006_add_public_key.sql` adds `public_key` column to `agents` table
- `agents.publicKey` tRPC query — fetch any agent's public key by wallet address
- `agents.setPublicKey` tRPC mutation — store public key (device apiToken auth)
- Device registration now accepts and stores `publicKey` automatically

`taskmarket init` and `taskmarket wallet import` now derive and send the public key at registration time. No new npm dependencies — uses Node.js built-in `crypto` (secp256k1 ECDH, HKDF-SHA256, AES-256-GCM).

File format: `version(1) | ephPubKey(65) | iv(12) | tag(16) | ciphertext`
