# Solana Wallet — Key Generation & Security

## Skill Description

Generate Solana wallets and vanity addresses securely using only official Solana Labs libraries — with Ed25519 key generation, memory zeroization, file permission hardening, and offline-only operation across Rust, TypeScript, and Shell implementations.

## Context

This toolkit generates Solana Ed25519 keypairs using ONLY official Solana Labs cryptographic libraries. No third-party crypto dependencies are permitted. Keys are output in Solana CLI-compatible JSON format. The toolkit supports vanity address generation (custom prefixes/suffixes) with multi-threaded search.

## Key Files

### Rust Implementation
- `rust/src/main.rs` — CLI entry point with clap
- `rust/src/generator.rs` — `VanityGenerator` struct, parallel key generation with rayon
- `rust/src/matcher.rs` — `MatchTarget` enum, `OptimizedMatcher` for pattern matching
- `rust/src/output.rs` — File output in Solana CLI format
- `rust/src/security.rs` — Memory zeroization, RNG verification
- `rust/src/config.rs` — Configuration types

### TypeScript Implementation
- `typescript/src/index.ts` — CLI entry point
- `typescript/src/lib/generator.ts` — Key generation using @solana/web3.js
- `typescript/src/lib/matcher.ts` — Pattern matching
- `typescript/src/lib/output.ts` — File output
- `typescript/src/lib/security.ts` — Security utilities

### Shell Scripts
- `scripts/generate-vanity.sh` — Wrapper around `solana-keygen grind`
- `scripts/batch-generate.sh` — Batch generation from file
- `scripts/verify-keypair.sh` — Keypair verification

### Verification
- `tools/verify-keypair.ts` — Verify keypair JSON files

## Approved Cryptographic Libraries

| Implementation | Library | Maintainer | Repository |
|----------------|---------|------------|------------|
| Rust | `solana-sdk` | Solana Labs | github.com/solana-labs/solana |
| TypeScript | `@solana/web3.js` | Solana Labs | github.com/solana-labs/solana-web3.js |
| Shell | `solana-keygen` | Solana Labs | Solana CLI toolchain |

**No other cryptographic dependencies are permitted.**

## Key Format

Solana CLI compatible JSON array of 64 bytes:
```json
[174,47,154,16,202,193,206,113,199,190,53,133,169,175,31,56,...]
```
- Bytes 0-31: Ed25519 secret key seed
- Bytes 32-63: Public key

Load with: `solana config set --keypair keypair.json`

## Solana Address Format

- Algorithm: Ed25519
- Encoding: Base58 (alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`)
- Length: 32-44 characters
- No: `0`, `O`, `I`, `l` (to avoid visual confusion)

## Vanity Address Difficulty

| Prefix Length | Combinations | Estimated Time |
|---------------|-------------|----------------|
| 1 char | 1 in 58 | Instant |
| 2 chars | 1 in 3,364 | < 1 sec |
| 3 chars | 1 in 195,112 | ~2 sec |
| 4 chars | 1 in 11,316,496 | ~2 min |
| 5 chars | 1 in 656,356,768 | ~2 hours |
| 6 chars | 1 in 38+ billion | ~4 days |

## Security Checklist

- [x] Uses ONLY official Solana Labs cryptographic libraries
- [x] Memory zeroization after key use (Rust `zeroize` crate)
- [x] File permissions set to `0600` (owner read/write only)
- [x] RNG quality verified before generation
- [x] No network calls — fully offline capable
- [x] Open source and auditable

## Key Generation Flow

### Rust
1. Parse CLI args with `clap`
2. Verify RNG quality (`security::verify_rng_quality()`)
3. Spawn `rayon` thread pool with N threads
4. Each thread: `Keypair::new()` via `solana-sdk`
5. Check if `pubkey.to_string()` matches pattern
6. On match: save to JSON, zeroize memory

### TypeScript
1. Parse CLI args with `parseArgs()`
2. Loop: `Keypair.generate()` via `@solana/web3.js`
3. Check if `publicKey.toBase58()` matches pattern
4. On match: save `secretKey` array to JSON

## Patterns to Follow

- NEVER add non-official cryptographic dependencies
- Always zeroize key material after use
- Maintain Solana CLI output format compatibility
- Set file permissions to `0600` for keypair files
- Verify RNG quality before generation in Rust
- Test across all implementations (Rust, TS, Shell)

## Common Pitfalls

- Not zeroizing keypair bytes from memory after saving
- Writing keypair files with default permissions (world-readable)
- Using non-official Ed25519 implementations
- Case sensitivity in vanity matching — Base58 is case-sensitive
- Solana addresses don't start with `0`, `O`, `I`, or `l` — these aren't in Base58
