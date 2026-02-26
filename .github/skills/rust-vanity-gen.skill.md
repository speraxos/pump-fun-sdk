# Rust Vanity Generator — High-Performance Address Mining

## Skill Description

Build and optimize the high-performance Rust vanity address generator — a multi-threaded CLI tool using `rayon` and `solana-sdk` for parallel Base58 pattern matching with prefix, suffix, and combined matching support.

## Context

The Rust implementation is the highest-performance vanity address generator in the toolkit, leveraging `rayon` for data-parallel key generation across all CPU cores. It uses `solana-sdk` for Ed25519 key generation and outputs Solana CLI-compatible JSON keypair files.

## Key Files

- `rust/src/main.rs` — CLI entry point, `clap::Parser` args, error handling
- `rust/src/generator.rs` — `VanityGenerator` struct, parallel generation with `rayon`
- `rust/src/matcher.rs` — `MatchTarget` enum, `OptimizedMatcher`, `MatchStatistics`
- `rust/src/output.rs` — File output in Solana CLI JSON format
- `rust/src/security.rs` — Memory zeroization, RNG quality verification
- `rust/src/config.rs` — Configuration types
- `rust/src/lib.rs` — Library re-exports
- `rust/Cargo.toml` — Dependencies

## CLI Options

```
solana-vanity [OPTIONS]

Options:
  --prefix <PREFIX>      Prefix pattern to match
  --suffix <SUFFIX>      Suffix pattern to match
  --ignore-case          Case-insensitive matching
  --threads <N>          Number of threads (default: all CPUs)
  --output <PATH>        Output directory for keypair files
  --count <N>            Number of addresses to find
  --verbose              Enable verbose output
  --dry-run              Estimate difficulty without generating
  --benchmark            Run performance benchmark
  --quiet                Suppress progress output
  --verify               Verify generated keypair
```

## Core Types

### VanityGenerator

```rust
pub struct VanityGenerator {
    config: VanityGeneratorConfig,
    matcher: OptimizedMatcher,
    cancelled: Arc<AtomicBool>,
    attempts: Arc<AtomicU64>,
}

pub struct VanityGeneratorConfig {
    pub threads: usize,
    pub verify_keypairs: bool,
    pub progress_interval: Duration,
}
```

### MatchTarget

```rust
pub enum MatchTarget {
    Prefix { pattern: String, case_insensitive: bool },
    Suffix { pattern: String, case_insensitive: bool },
    Both { prefix: String, suffix: String, case_insensitive: bool },
}
```

### OptimizedMatcher

Pre-computes lowercase patterns for case-insensitive matching to avoid repeated `to_lowercase()` calls in the hot loop.

### MatchStatistics

```rust
pub struct MatchStatistics {
    pub total_checked: u64,
    pub partial_prefix_matches: u64,
    pub matching_time_ns: u64,
}
```

## Dependencies

| Crate | Purpose | Security Role |
|-------|---------|---------------|
| `solana-sdk` | Key generation (Ed25519) | Official crypto |
| `rayon` | Thread pool parallelism | Non-crypto |
| `clap` | CLI argument parsing | Non-crypto |
| `serde` / `serde_json` | JSON serialization | Non-crypto |
| `zeroize` | Memory clearing | Security hygiene |
| `thiserror` | Error types | Non-crypto |
| `num_cpus` | CPU core detection | Non-crypto |
| `libc` / `nix` | Unix file permissions | Security hygiene |
| `log` | Logging | Non-crypto |

## Generation Flow

```
main() → VanityGenerator::new(target, config)
    → security::verify_rng_quality()
    → rayon::ThreadPoolBuilder::new().num_threads(N).build()
    → pool.install(|| {
        par_iter: loop {
            let keypair = Keypair::new();         // solana-sdk
            let address = keypair.pubkey().to_string();
            if matcher.matches(&address) {
                output::save_keypair(&keypair, path);
                zeroize keypair bytes;
                return Some(result);
            }
        }
    })
```

## Benchmarking

```bash
cd rust && cargo bench
# or
cargo run --release -- --benchmark --prefix A
```

Benchmark files: `rust/benches/generation_bench.rs`

## Testing

```bash
cd rust && cargo test
# Integration tests
cargo test --test integration_tests
# Performance tests
cargo test --test performance_tests
# Security tests
cargo test --test security_tests
```

## Patterns to Follow

- Use `#[inline]` on hot-path matching functions
- Pre-compute lowercase patterns in `OptimizedMatcher::new()`
- Use `AtomicBool` for cancellation, `AtomicU64` for attempt counting
- Verify RNG quality before starting generation
- Zeroize all key material immediately after saving
- Set output file permissions to `0600`
- Validate Base58 pattern characters before starting search

## Common Pitfalls

- Not checking `is_valid_base58_char()` before searching — invalid chars waste time
- Forgetting to zeroize `keypair.to_bytes()` after saving
- Using `Mutex` instead of atomics for hot-path counters
- Not setting `--release` flag — debug builds are 10-50x slower
- Case-insensitive matching doubles the character space from 58 to ~35 effective chars
