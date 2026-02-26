# Fee Sharing — Creator Fee Distribution

## Skill Description

Configure and manage creator fee sharing — allowing token creators to distribute accumulated trading fees to multiple shareholders using the PumpFees program with BPS-based share allocation and cross-program support.

## Context

Pump charges trading fees split between protocol and creator. The Fee Sharing system lets creators distribute their portion to up to 10 shareholders proportionally. It works across both the bonding curve (Pump program) and graduated AMM (PumpAMM program).

## Key Files

- `src/sdk.ts` — `createFeeSharingConfig`, `updateFeeShares`, `distributeCreatorFees`, `getMinimumDistributableFee`
- `src/onlineSdk.ts` — `buildDistributeCreatorFeesInstructions`, `getMinimumDistributableFee`, `collectCoinCreatorFeeInstructions`
- `src/errors.ts` — Shareholder validation error classes
- `src/state.ts` — `SharingConfig`, `Shareholder`, `DistributeCreatorFeesEvent`, `MinimumDistributableFeeEvent`
- `src/pda.ts` — `feeSharingConfigPda(mint)`, `creatorVaultPda(creator)`, `ammCreatorVaultPda(creator)`
- `docs/fee-sharing.md` — Full workflow documentation

## Workflow

### 1. Create Fee Sharing Config

```typescript
const ix = PUMP_SDK.createFeeSharingConfig({ creator, mint, pool? });
```

- If token is graduated, pass `pool` (AMM pool pubkey)
- Creates a `SharingConfig` PDA for the mint

### 2. Set Shareholders

```typescript
const ix = PUMP_SDK.updateFeeShares({
    creator,
    mint,
    shareholders: [
        { address: new PublicKey("..."), shareBps: 5000 },
        { address: new PublicKey("..."), shareBps: 5000 }
    ]
});
```

### 3. Check Distributable Fees

```typescript
const result = await onlineSdk.getMinimumDistributableFee(mint);
// { minimumRequired, distributableFees, canDistribute, isGraduated }
```

### 4. Distribute

```typescript
const { instructions, isGraduated } = await onlineSdk.buildDistributeCreatorFeesInstructions(mint);
```

For graduated tokens, this automatically prepends `transferCreatorFeesToPump` to consolidate AMM fees first.

### 5. Check Status

```typescript
const isSharingEnabled = isCreatorUsingSharingConfig({ mint, creator });
```

## Validation Rules

| Rule | Error Class |
|------|------------|
| At least 1 shareholder | `NoShareholdersError` |
| Maximum 10 shareholders | `TooManyShareholdersError` |
| No zero-share entries | `ZeroShareError` |
| Shares sum to 10,000 BPS | `InvalidShareTotalError` |
| No duplicate addresses | `DuplicateShareholderError` |
| Graduated tokens need pool | `PoolRequiredForGraduatedError` |

## State Types

```typescript
interface SharingConfig {
    version: number;
    mint: PublicKey;
    admin: PublicKey;
    adminRevoked: boolean;
    shareholders: Shareholder[];
}

interface Shareholder {
    address: PublicKey;
    shareBps: number;  // Basis points (1 = 0.01%, 10000 = 100%)
}
```

## Direct Fee Collection (Without Sharing)

Creators who haven't opted into fee sharing can collect directly:

```typescript
const ixs = await onlineSdk.collectCoinCreatorFeeInstructions(creator);
const balance = await onlineSdk.getCreatorVaultBalanceBothPrograms(creator);
```

## Patterns to Follow

- Validate shareholder arrays before sending: max 10, sum = 10,000 BPS, no duplicates, no zero shares
- Use `BothPrograms` methods when you need to aggregate across Pump + PumpAMM
- Always check `isGraduated` to determine if AMM fee consolidation is needed
- Use typed error classes from `src/errors.ts` for validation failures

## Common Pitfalls

- Shares must total exactly 10,000 BPS (100%) — not 100, not 1,000,000
- Graduated tokens require the `pool` parameter for config creation
- `distributeCreatorFees` will fail if `canDistribute === false` (below minimum threshold)
- Two separate creator vaults exist: Pump vault (`creatorVaultPda`) and AMM vault (`ammCreatorVaultPda`)
