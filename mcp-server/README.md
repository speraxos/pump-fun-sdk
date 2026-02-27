# Solana Wallet & Pump Protocol MCP Server

A Model Context Protocol (MCP) server that exposes Solana wallet operations and Pump protocol tools to AI assistants like Claude.

## Features

- **Generate Keypairs**: Create new Solana keypairs
- **Vanity Addresses**: Generate addresses with custom prefixes/suffixes
- **Sign Messages**: Sign arbitrary messages with keypairs
- **Verify Signatures**: Verify message signatures
- **Validate Addresses**: Check if Solana addresses are valid
- **Restore Keypairs**: Recover from seed phrases or private keys
- **Pump Protocol**: Full token lifecycle — quoting, creating, trading, migrating, fee sharing, and incentives

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "solana-wallet": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"]
    }
  }
}
```

### Standalone

```bash
npm start
```

## Available Tools

### Wallet Tools

| Tool | Description |
|------|-------------|
| `generate_keypair` | Generate a new Solana keypair |
| `generate_vanity` | Generate a vanity address with prefix/suffix |
| `sign_message` | Sign a message with a keypair |
| `verify_signature` | Verify a message signature |
| `validate_address` | Validate a Solana address format |
| `estimate_vanity_time` | Estimate time to find a vanity address |
| `restore_keypair` | Restore keypair from seed phrase or private key |

### Pump Protocol Tools

#### Quoting & Market Data

| Tool | Description |
|------|-------------|
| `quote_buy` | Quote how many tokens you get for a given SOL amount |
| `quote_sell` | Quote how much SOL you get for selling tokens |
| `quote_buy_cost` | Quote how much SOL is needed to buy a given token amount |
| `get_market_cap` | Get the current market cap of a bonding curve token |
| `get_bonding_curve` | Fetch bonding curve state for a token |

#### Token Lifecycle

| Tool | Description |
|------|-------------|
| `build_create_token` | Build a token creation instruction |
| `build_create_and_buy` | Build create + buy instructions atomically |
| `build_buy` | Build a buy instruction for bonding curve tokens |
| `build_sell` | Build a sell instruction for bonding curve tokens |
| `build_migrate` | Build a migration instruction for graduated tokens |

#### Fee System

| Tool | Description |
|------|-------------|
| `calculate_fees` | Calculate fee amounts for a trade |
| `get_fee_tier` | Get the fee tier for a given market cap |
| `build_create_fee_sharing` | Build a fee sharing config creation instruction |
| `build_update_fee_shares` | Build an instruction to update shareholder distribution |
| `build_distribute_fees` | Build instructions to distribute accumulated fees |
| `get_creator_vault_balance` | Get creator's accumulated fee balance |
| `build_collect_creator_fees` | Build instructions to collect creator fees |

#### Token Incentives

| Tool | Description |
|------|-------------|
| `build_init_volume_tracker` | Initialize user volume tracking |
| `build_claim_incentives` | Build instructions to claim token incentive rewards |
| `get_unclaimed_rewards` | Get user's unclaimed token rewards |
| `get_volume_stats` | Get user's trading volume statistics |

#### Utilities

| Tool | Description |
|------|-------------|
| `derive_pda` | Derive a Program Derived Address |
| `fetch_global_state` | Fetch the global Pump protocol config |
| `fetch_fee_config` | Fetch the fee tier configuration |
| `get_program_ids` | Get all Pump protocol program IDs |

## Available Resources

| Resource | Description |
|----------|-------------|
| `solana://config` | Server configuration |
| `solana://keypair/{id}` | Access generated keypairs (public key only) |
| `solana://address/{pubkey}` | Address information |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `create_wallet` | Guided wallet creation workflow |
| `security_audit` | Security best practices checklist |
| `batch_generate` | Generate multiple keypairs at once |

## Security

⚠️ **CRITICAL**: This server handles cryptocurrency private keys.

- Private keys are **never logged** or persisted to disk
- Keys are **zeroized from memory** on shutdown
- All inputs are **strictly validated**
- Uses official Solana libraries only

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Protocol Version

This server implements MCP protocol version `2024-11-05`.

## License

MIT

