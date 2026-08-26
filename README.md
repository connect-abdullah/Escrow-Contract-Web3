# User Registry (CLI + Scripts)

This project contains a small Ethereum smart contract (`UserRegistry`) plus Node/TypeScript scripts to:

- `deploy` the contract
- `register` a user (create an entry in the contract)
- `update` a user (update investments + PnL)
- `read` a user (query stored values)

It also includes an interactive CLI (`scripts/cli.ts`) that lets you choose between **two wallets** for write operations (`register` and `update`). The `read` action does not require a wallet.

## How the contract works

The contract stores a mapping:

- `users[userId] -> { owner, userId, investments, pnl, exists }`

### `registerUser(userId, investments, pnl)`

- Reverts if `users[userId]` already exists.
- Reverts if `userId == 0`.
- Stores:
  - `owner = msg.sender`
  - `userId`
  - `investments`
  - `pnl`
- Emits:
  - `UserRegistered(owner, userId, investments, pnl)`

### `updateUser(userId, investments, pnl)`

- Reverts if the user does not exist.
- Reverts if `msg.sender != users[userId].owner` (only the registering wallet can update).
- Updates:
  - `investments`
  - `pnl`
- Emits:
  - `UserUpdated(owner, userId, investments, pnl)`

### `getUser(userId)`

Read-only function returning:

- `owner`
- `userId`
- `investments`
- `pnl`

## Events (what you’ll see in the CLI/scripts)

After `register` or `update`, the scripts decode the transaction receipt logs and print the emitted event:

- `UserRegistered`
  - `owner`
  - `userId`
  - `investments`
  - `pnl`
- `UserUpdated`
  - `owner`
  - `userId`
  - `investments`
  - `pnl`

If your transaction reverts, you won’t get these events.

## Project setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your environment file:
   - Copy `.env.example` to `.env`
   - Fill in at least:
     - `RPC_URL`
     - `PRIVATE_KEY_1` and/or `PRIVATE_KEY_2` (for CLI write actions)
     - `PRIVATE_KEY` (for the manual scripts; CLI may also fall back to this for wallet 1)

> Note: The CLI can also prompt for missing values and write them into `.env` automatically.

## Environment variables

Expected variables in `.env`:

- `RPC_URL`: JSON-RPC URL for your chain (e.g. `http://127.0.0.1:8545`)
- `PRIVATE_KEY`: signer key used by the manual scripts (wallet selection is not used there)
- `PRIVATE_KEY_1`: private key for wallet selection `1`
- `PRIVATE_KEY_2`: private key for wallet selection `2`
- `CONTRACT_ADDRESS`: the deployed `UserRegistry` address

## Manual script usage

You can run the scripts directly (without the interactive CLI).

### Deploy

```bash
npx tsx scripts/deploy.ts
```

The script will deploy and print the deployed contract address.
Copy that value into `CONTRACT_ADDRESS` in `.env` before running `register/update/read`.

### Register user

```bash
npx tsx scripts/registerUser.ts
```

### Update user

```bash
npx tsx scripts/updateUser.ts
```

### Read user

```bash
npx tsx scripts/readUser.ts
```

## CLI usage (recommended)

### Interactive mode

```bash
npm run cli
```

You will see a menu:

- Deploy
- Register user
- Update user
- Read user

For `register` and `update`, the CLI will ask you to choose **wallet 1 or wallet 2**. The transaction sender is the selected wallet.

For `read`, it uses only `RPC_URL` + `CONTRACT_ADDRESS`.

### Non-interactive mode (CLI reference)

Read:
```bash
npm run cli -- read --userId 2
```

Deploy:
```bash
npm run cli -- deploy --wallet 1
```

Register:
```bash
npm run cli -- register --wallet 1 --userId 2 --investments 5000 --pnl 700
```

Update:
```bash
npm run cli -- update --wallet 1 --userId 2 --investments 5000 --pnl 9000
```

### Missing configuration behavior

- `CONTRACT_ADDRESS`
  - If missing, the CLI will ask whether to deploy now.
  - After a successful deploy, it writes `CONTRACT_ADDRESS` into `.env`.
- `RPC_URL` / `PRIVATE_KEY_1` / `PRIVATE_KEY_2`
  - If missing, the CLI will prompt you and then write the values into `.env`.

## Important note about “two wallets”

Because `updateUser` requires `msg.sender == users[userId].owner`, you must:

- Register using wallet `1` (if `PRIVATE_KEY_1` is selected)
- Update using the same wallet that originally registered that `userId`

If you try to update from the other wallet, the transaction will revert with `You are not the owner of this user`.

