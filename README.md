# Pump SDK

Official Pump program SDK for creating, buying, and selling tokens on the Solana blockchain.

[![npm](https://img.shields.io/npm/v/@pump-fun/pump-sdk)](https://www.npmjs.com/package/@pump-fun/pump-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, and first transaction |
| [Architecture](docs/architecture.md) | SDK structure, lifecycle, and design patterns |
| [API Reference](docs/api-reference.md) | Full class, function, and type documentation |
| [Examples](docs/examples.md) | Practical code examples for common operations |
| [Fee Sharing](docs/fee-sharing.md) | Creator fee distribution to shareholders |
| [Token Incentives](docs/token-incentives.md) | Volume-based trading rewards |

## Installation

```bash
npm install @pump-fun/pump-sdk
```

## Quick Start

```Typescript
import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";

const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
);

// Online SDK (fetches on-chain state)
const sdk = new OnlinePumpSdk(connection);

// Offline SDK singleton (instruction builder only)
const offlineSdk = PUMP_SDK;
```

## Coin creation

```Typescript
const mint = PublicKey.unique();
const creator = PublicKey.unique();
const user = PublicKey.unique();

const instruction = await sdk.createInstruction({
    mint,
    name: "name",
    symbol: "symbol",
    uri: "uri",
    creator,
    user,
});

// or creating and buying instructions in the same tx

const global = await sdk.fetchGlobal();
const solAmount = new BN(0.1 * 10 ** 9); // 0.1 SOL

const instructions = await sdk.createAndBuyInstructions({
    global,
    mint,
    name: "name",
    symbol: "symbol",
    uri: "uri",
    creator,
    user,
    solAmount,
    amount: getBuyTokenAmountFromSolAmount(global, null, solAmount),
});
```

## Buying coins

```Typescript
const mint = PublicKey.unique();
const user = PublicKey.unique();

const global = await sdk.fetchGlobal();
const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
    await sdk.fetchBuyState(mint, user);
const solAmount = new BN(0.1 * 10 ** 9); // 0.1 SOL

const instructions = await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    solAmount,
    amount: getBuyTokenAmountFromSolAmount(global, bondingCurve, solAmount),
    slippage: 1,
});
```

## Selling coins

```Typescript
const mint = PublicKey.unique();
const user = PublicKey.unique();

const global = await sdk.fetchGlobal();
const { bondingCurveAccountInfo, bondingCurve } = await sdk.fetchSellState(mint, user);
const amount = new BN(15_828);

const instructions = await sdk.sellInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    mint,
    user,
    amount,
    solAmount: getSellSolAmountFromTokenAmount(global, bondingCurve, amount),
    slippage: 1,
});
```

## Creator fees

```Typescript
const user = PublicKey.unique();

// Getting total accumulated creator fees for both Pump and PumpSwap programs
console.log((await sdk.getCreatorVaultBalanceBothPrograms(user)).toString());

// Collecting creator fees instructions
const instructions = await sdk.collectCoinCreatorFeeInstructions(user);
```

## Fee Sharing

Fee sharing allows token creators to set up fee distribution to multiple shareholders. The `OnlinePumpSdk` provides methods to check distributable fees and distribute them.

```Typescript
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";

const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
);
const onlineSdk = new OnlinePumpSdk(connection);
const mint = new PublicKey("...");
```

### Check if Creator Has Migrated to Fee Sharing

Before checking or distributing fees, verify that the coin creator has set up fee sharing:

```Typescript
const usingSharingConfig = isCreatorUsingSharingConfig({ mint, creator });

if (!usingSharingConfig) {
    console.log("Creator has not set up fee sharing");
    return;
}

// Creator has migrated, proceed with fee distribution
```

### Get Minimum Distributable Fee

Check whether a coin's fee sharing configuration balance and distributable fees

```Typescript
const result = await onlineSdk.getMinimumDistributableFee(mint);

console.log("Minimum required:", result.minimumRequired.toString());
console.log("Distributable fees:", result.distributableFees.toString());
console.log("Can distribute:", result.canDistribute);
console.log("Is graduated:", result.isGraduated);
```

This method handles both graduated (AMM) and non-graduated (bonding curve) tokens. For graduated tokens, it automatically consolidates fees from the AMM vault before calculating.

### Distribute Creator Fees

Build instructions to distribute accumulated creator fees to shareholders:

```Typescript
const { instructions, isGraduated } = await onlineSdk.buildDistributeCreatorFeesInstructions(mint);

// instructions contains:
// - For graduated tokens: transferCreatorFeesToPump + distributeCreatorFees
// - For non-graduated tokens: distributeCreatorFees only

// Add instructions to your transaction
const tx = new Transaction().add(...instructions);
```

This method automatically handles graduated tokens by including the `transferCreatorFeesToPump` instruction to consolidate fees from the AMM vault before distributing.
## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)