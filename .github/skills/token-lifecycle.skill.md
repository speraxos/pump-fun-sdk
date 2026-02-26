# Token Lifecycle — Create, Trade, Migrate

## Skill Description

Manage the full lifecycle of Pump tokens from creation through bonding curve trading, graduation, and AMM migration — using the offline `PumpSdk` and online `OnlinePumpSdk`.

## Context

Pump tokens follow a defined lifecycle: creation → bonding curve trading → graduation (when market cap reaches threshold) → AMM migration. The SDK provides instruction builders for each phase, with both offline and online variants.

## Key Files

- `src/sdk.ts` — `PumpSdk` class with all instruction builders
- `src/onlineSdk.ts` — `OnlinePumpSdk` with RPC fetchers and composed workflows
- `src/pda.ts` — Program Derived Addresses for all accounts
- `src/state.ts` — On-chain state type definitions
- `src/errors.ts` — Error classes for validation failures

## Lifecycle Phases

### 1. Token Creation

```typescript
// V2 creation with Token-2022
const ix = await PUMP_SDK.createV2Instruction({
    mint, name, symbol, uri, creator, user
});

// Create + buy in same transaction
const ixs = await PUMP_SDK.createV2AndBuyInstructions({
    global, feeConfig, mint, name, symbol, uri, creator, user,
    solAmount, amount, slippage
});
```

- `createInstruction` (v1) is **deprecated** — use `createV2Instruction` (Token-2022)
- `createV2AndBuyInstructions` bundles creation + first purchase atomically

### 2. Buying Tokens

```typescript
const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
    await sdk.fetchBuyState(mint, user);

const ixs = await sdk.buyInstructions({
    global, bondingCurveAccountInfo, bondingCurve,
    associatedUserAccountInfo, mint, user,
    solAmount, amount, slippage
});
```

- `fetchBuyState()` retrieves bonding curve + user ATA info in one batch call
- Handles ATA creation automatically if needed
- Passes `{ 0: true }` flags argument — this is intentional

### 3. Selling Tokens

```typescript
const { bondingCurveAccountInfo, bondingCurve } =
    await sdk.fetchSellState(mint, user);

const ixs = await sdk.sellInstructions({
    global, bondingCurveAccountInfo, bondingCurve,
    mint, user, amount, solAmount, slippage
});
```

### 4. Graduation Detection

```typescript
const bondingCurve = await sdk.fetchBondingCurve(mint);
if (bondingCurve.complete) {
    // Token has graduated — bonding curve trading will fail
    // Use AMM pool instead
}
```

### 5. AMM Migration

```typescript
const ix = await PUMP_SDK.migrateInstruction({ mint, creator });
```

- Only callable after graduation (`complete === true`)
- Migrates liquidity from bonding curve to PumpAMM pool
- Account may need extension first: `extendAccountInstruction()`

## Key Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `PUMP_PROGRAM_ID` | `6EF8...` | Bonding curve program |
| `PUMP_AMM_PROGRAM_ID` | `pAMM...` | AMM pool program |
| `PUMP_FEE_PROGRAM_ID` | `Fees...` | Fee sharing program |
| `MAYHEM_PROGRAM_ID` | varies | Mayhem mode program |
| `BONDING_CURVE_NEW_SIZE` | `151` | Account size after extension |

## PDAs

| PDA | Derivation |
|-----|-----------|
| `bondingCurvePda(mint)` | Bonding curve account |
| `creatorVaultPda(creator)` | Creator fee vault (Pump) |
| `ammCreatorVaultPda(creator)` | Creator fee vault (AMM) |
| `canonicalPumpPoolPda(mint)` | AMM pool for graduated token |
| `feeSharingConfigPda(mint)` | Fee sharing config |

## Patterns to Follow

- Return `TransactionInstruction[]`, never `Transaction` objects — callers compose transactions
- Use `getMultipleAccountsInfo` to batch RPC calls (2-3 accounts per call)
- Support both Token (SPL) and Token-2022 via `tokenProgram` parameter
- All RPC calls belong in `OnlinePumpSdk`, not `PumpSdk`
- `PUMP_SDK` is a pre-initialized offline singleton — use it for pure instruction building

## Common Pitfalls

- Circular dependency between `sdk.ts` and `onlineSdk.ts` — handle imports carefully
- `BONDING_CURVE_NEW_SIZE = 151` — accounts may need `extendAccountInstruction` before migration
- `BondingCurve.complete === true` means graduated — bonding curve buy/sell will fail
- Buy instruction deliberately passes `{ 0: true }` flags — this is not a bug
- `createInstruction` (v1) is deprecated — always use `createV2Instruction`
