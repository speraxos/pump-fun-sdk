# Bonding Curve — Pricing & Quoting Engine

## Skill Description

Implement and maintain the constant-product AMM bonding curve math that powers Pump token pricing — including buy/sell quoting, fee-aware calculations, market cap computation, and reserve management.

## Context

Pump tokens are priced using a constant-product bonding curve (`x * y = k`) where `x` = virtual SOL reserves and `y` = virtual token reserves. The bonding curve determines token prices during the pre-graduation phase. Once market cap reaches a threshold, the token "graduates" and migrates to a PumpAMM pool.

## Key Files

- `src/bondingCurve.ts` — All bonding curve math functions
- `src/fees.ts` — Fee calculation, tiered fee system, fee recipient selection
- `src/state.ts` — `BondingCurve`, `Global`, `FeeConfig`, `FeeTier` interfaces

## Key Functions

### Quoting

| Function | Purpose |
|----------|---------|
| `getBuyTokenAmountFromSolAmount()` | Quote: how many tokens for X SOL |
| `getBuySolAmountFromTokenAmount()` | Quote: how much SOL to buy X tokens |
| `getSellSolAmountFromTokenAmount()` | Quote: how much SOL received for selling X tokens |

### Curve Management

| Function | Purpose |
|----------|---------|
| `newBondingCurve(global)` | Create fresh curve from global defaults |
| `bondingCurveMarketCap()` | Compute market cap from reserves |
| `getStaticRandomFeeRecipient()` | Pick random fee recipient |

## Key Concepts

### Constant Product Formula

```
virtualSolReserves × virtualTokenReserves = k (constant)
```

When buying tokens:
1. User sends SOL → increases `virtualSolReserves`
2. Tokens are removed from `virtualTokenReserves`
3. Product `k` stays constant (minus fees)

### Fee-Aware Quoting

All quote functions accept optional `feeConfig` and `mintSupply` for tiered fee support:
- Without `feeConfig`: uses legacy flat fees from `global`
- With `feeConfig`: uses market-cap-based tiered fees via `computeFeesBps()`

### Fee Tiers

```typescript
interface FeeTier {
    marketCapThreshold: BN;  // SOL threshold
    fees: Fees;              // { lpFeeBps, protocolFeeBps, creatorFeeBps }
}
```

Fee tiers are sorted by market cap, and the tier whose threshold the current market cap exceeds is selected.

### Slippage Calculation

```
maxSolCost = solAmount + (solAmount × slippage × 10 / 1000)
minSolReceived = solAmount - (solAmount × slippage × 10 / 1000)
```

Where `slippage` is in tenths of a percent (e.g., `slippage: 1` = 0.1%).

## BondingCurve State

```typescript
interface BondingCurve {
    virtualTokenReserves: BN;
    virtualSolReserves: BN;
    realTokenReserves: BN;
    realSolReserves: BN;
    tokenTotalSupply: BN;
    complete: boolean;        // true = graduated to AMM
    creator: PublicKey;
    mayhemMode: boolean;
}
```

## Patterns to Follow

- All amounts use `BN` (big number) — never use JavaScript `number` for token math
- Fee calculation uses ceiling division (`ceilDiv`) to avoid dust issues
- Quote functions are pure — no network calls, no side effects
- Always check `bondingCurve.complete` before building trade instructions
- `virtualTokenReserves` and `virtualSolReserves` include virtual liquidity (not withdrawable)
- `realTokenReserves` and `realSolReserves` track actual deposited amounts

## Common Pitfalls

- Confusing virtual reserves (includes virtual offset) with real reserves (actual amounts)
- Not accounting for fees when quoting — use `getFee()` to compute total fee
- Trying to trade on a graduated curve (`complete === true`) will fail
- Fee recipient selection is random from `global.feeRecipients[]` — don't assume deterministic ordering
- Market cap calculation uses `mintSupply` not `tokenTotalSupply` — these differ when tokens are in the curve
