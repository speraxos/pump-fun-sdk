# Pump SDK

The official TypeScript SDK for the [Pump](https://pump.fun) protocol on Solana — create tokens, trade on bonding curves, graduate to AMM pools, share creator fees, and earn volume-based rewards.

[![npm version](https://img.shields.io/npm/v/@pump-fun/pump-sdk)](https://www.npmjs.com/package/@pump-fun/pump-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Token Lifecycle](#token-lifecycle)
- [Usage](#usage)
  - [Create a Token](#create-a-token)
  - [Buy Tokens](#buy-tokens)
  - [Sell Tokens](#sell-tokens)
  - [Creator Fees](#creator-fees)
  - [Fee Sharing](#fee-sharing)
  - [Token Incentives](#token-incentives)
- [Architecture](#architecture)
- [Programs](#programs)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Token creation** — launch tokens on a bonding curve with a single instruction
- **Buy & sell** — trade with configurable slippage protection and bonding curve math
- **Create + buy atomically** — launch and purchase in one transaction
- **Bonding curve graduation** — automatic migration to AMM pools when thresholds are met
- **Creator fees** — collect accumulated trading fees across both programs
- **Fee sharing** — split creator fees among up to 10 shareholders
- **Volume-based rewards** — earn token incentives proportional to trading volume
- **Offline & online modes** — build instructions without a connection, or fetch live state
- **Full TypeScript types** — strongly typed via Anchor IDL

---

## Installation

```bash
npm install @pump-fun/pump-sdk
```

### Peer Dependencies

```bash
npm install @solana/web3.js @coral-xyz/anchor @solana/spl-token bn.js
```

> Also works with `yarn` and `pnpm`.

---

## Quick Start

```typescript
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";

// Connect to Solana
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Online SDK — fetches on-chain state and builds transactions
const sdk = new OnlinePumpSdk(connection);

// Offline SDK singleton — builds instructions without a network connection
const offlineSdk = PUMP_SDK;
```

---

## Token Lifecycle

```
┌─────────────────────────┐                        ┌─────────────────────────┐
│     Bonding Curve        │    graduation           │      AMM Pool            │
│     (Pump Program)       │ ─────────────────────► │      (PumpAMM Program)   │
│                          │   complete = true       │                          │
│  • createV2              │                         │  • Pool-based swaps      │
│  • buy / sell            │                         │  • LP fees               │
│  • Price discovery       │                         │  • Graduated trading     │
└─────────────────────────┘                         └─────────────────────────┘
```

1. **Create** — a new token starts on a bonding curve via `createV2Instruction`
2. **Trade** — users buy and sell; prices follow bonding curve math
3. **Graduate** — when `bondingCurve.complete` becomes `true`, the token qualifies for migration
4. **Migrate** — `migrateInstruction` moves the token to an AMM pool
5. **AMM trading** — post-graduation trading happens on the AMM with LP, protocol, and creator fees

---

## Usage

### Create a Token

```typescript
import { Keypair } from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";

const mint = Keypair.generate();

const instruction = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: "My Token",
  symbol: "MTK",
  uri: "https://example.com/metadata.json",
  creator: wallet.publicKey,
  user: wallet.publicKey,
  mayhemMode: false,
});
```

#### Create + Buy Atomically

```typescript
import BN from "bn.js";
import { getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";

const global = await sdk.fetchGlobal();
const feeConfig = await sdk.fetchFeeConfig();
const solAmount = new BN(0.5 * 1e9); // 0.5 SOL

const tokenAmount = getBuyTokenAmountFromSolAmount({
  global,
  feeConfig,
  mintSupply: null,
  bondingCurve: null,
  amount: solAmount,
});

const instructions = await PUMP_SDK.createV2AndBuyInstructions({
  global,
  mint: mint.publicKey,
  name: "My Token",
  symbol: "MTK",
  uri: "https://example.com/metadata.json",
  creator: wallet.publicKey,
  user: wallet.publicKey,
  amount: tokenAmount,
  solAmount,
  mayhemMode: false,
});

const tx = new Transaction().add(...instructions);
const sig = await sendAndConfirmTransaction(connection, tx, [wallet, mint]);
```

### Buy Tokens

```typescript
import BN from "bn.js";
import { getBuyTokenAmountFromSolAmount, PUMP_SDK } from "@pump-fun/pump-sdk";

const mint = new PublicKey("...");
const user = wallet.publicKey;
const solAmount = new BN(0.1 * 1e9); // 0.1 SOL

const global = await sdk.fetchGlobal();
const feeConfig = await sdk.fetchFeeConfig();
const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
  await sdk.fetchBuyState(mint, user);

const tokenAmount = getBuyTokenAmountFromSolAmount({
  global,
  feeConfig,
  mintSupply: bondingCurve.tokenTotalSupply,
  bondingCurve,
  amount: solAmount,
});

const instructions = await PUMP_SDK.buyInstructions({
  global,
  bondingCurveAccountInfo,
  bondingCurve,
  associatedUserAccountInfo,
  mint,
  user,
  solAmount,
  amount: tokenAmount,
  slippage: 2, // 2% slippage tolerance
});
```

### Sell Tokens

```typescript
import { getSellSolAmountFromTokenAmount, PUMP_SDK } from "@pump-fun/pump-sdk";

const { bondingCurveAccountInfo, bondingCurve } = await sdk.fetchSellState(mint, user);
const sellAmount = new BN(15_828);

const instructions = await PUMP_SDK.sellInstructions({
  global,
  bondingCurveAccountInfo,
  bondingCurve,
  mint,
  user,
  amount: sellAmount,
  solAmount: getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: sellAmount,
  }),
  slippage: 1, // 1% slippage tolerance
});
```

### Creator Fees

```typescript
// Check accumulated fees across both programs
const balance = await sdk.getCreatorVaultBalanceBothPrograms(wallet.publicKey);
console.log("Creator fees:", balance.toString(), "lamports");

// Collect fees
const instructions = await sdk.collectCoinCreatorFeeInstructions(wallet.publicKey);
```

### Fee Sharing

Split creator fees among multiple shareholders. See the full [Fee Sharing Guide](docs/fee-sharing.md).

```typescript
import { PUMP_SDK, isCreatorUsingSharingConfig } from "@pump-fun/pump-sdk";

// 1. Create a sharing config
const ix = await PUMP_SDK.createFeeSharingConfig({
  creator: wallet.publicKey,
  mint,
});

// 2. Set shareholders (shares must total 10,000 bps = 100%)
const ix = await PUMP_SDK.updateFeeShares({
  authority: wallet.publicKey,
  mint,
  currentShareholders: [],
  newShareholders: [
    { address: walletA, shareBps: 5000 }, // 50%
    { address: walletB, shareBps: 3000 }, // 30%
    { address: walletC, shareBps: 2000 }, // 20%
  ],
});

// 3. Check & distribute
const result = await sdk.getMinimumDistributableFee(mint);
if (result.canDistribute) {
  const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mint);
  const tx = new Transaction().add(...instructions);
}
```

### Token Incentives

Earn token rewards based on SOL trading volume. See the full [Token Incentives Guide](docs/token-incentives.md).

```typescript
import { PUMP_SDK } from "@pump-fun/pump-sdk";

// Initialize volume tracking (one-time)
const ix = await PUMP_SDK.initUserVolumeAccumulator({
  payer: wallet.publicKey,
  user: wallet.publicKey,
});

// Check unclaimed rewards
const rewards = await sdk.getTotalUnclaimedTokensBothPrograms(wallet.publicKey);
console.log("Unclaimed rewards:", rewards.toString());

// Claim rewards
const instructions = await sdk.claimTokenIncentivesBothPrograms(
  wallet.publicKey,
  wallet.publicKey,
);
```

---

## Architecture

The SDK is split into two layers:

| Layer | Class | Needs Connection? | Use Case |
|-------|-------|:------------------:|----------|
| **Offline** | `PumpSdk` | No | Build instructions, decode accounts, pure computation |
| **Online** | `OnlinePumpSdk` | Yes | Fetch on-chain state, simulate transactions |

`PumpSdk` uses a null Anchor provider internally so it can construct any instruction without touching the network. A pre-built singleton is exported as `PUMP_SDK`.

`OnlinePumpSdk` wraps `PumpSdk` with a real `Connection`, adding methods like `fetchGlobal()`, `fetchBuyState()`, and transaction simulation. Many methods have a `*BothPrograms` variant that combines results from both the Pump and PumpAMM programs.

```
src/
├── index.ts            # Public API — re-exports everything
├── sdk.ts              # PumpSdk (offline instruction builder)
├── onlineSdk.ts        # OnlinePumpSdk (fetcher + builder)
├── bondingCurve.ts     # Pure math for price quoting
├── fees.ts             # Fee tier calculation logic
├── errors.ts           # Custom error classes
├── pda.ts              # PDA derivation helpers
├── state.ts            # TypeScript interfaces for on-chain accounts
├── tokenIncentives.ts  # Volume-based reward calculations
└── idl/                # Anchor IDLs for all three programs
```

---

## Programs

The SDK interacts with three on-chain programs:

| Program | Address | Purpose |
|---------|---------|---------|
| **Pump** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Token creation, bonding curve buy/sell |
| **PumpAMM** | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | AMM pools for graduated tokens |
| **PumpFees** | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | Fee sharing configuration & distribution |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, and first transaction |
| [Architecture](docs/architecture.md) | SDK structure, lifecycle, and design patterns |
| [API Reference](docs/api-reference.md) | Full class, function, and type documentation |
| [Examples](docs/examples.md) | Practical code examples for common operations |
| [Fee Sharing](docs/fee-sharing.md) | Creator fee distribution to shareholders |
| [Token Incentives](docs/token-incentives.md) | Volume-based trading rewards |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)