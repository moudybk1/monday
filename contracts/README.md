# Monday contracts

`MondayRegistry` holds no funds and has no admin or upgrade path. A user publishes a risk policy
and authorises one agent; that agent logs a hash of every decision and kill. Spec: PRD section 13.

## Setup

Requires Foundry. `lib/` is not committed, so restore forge-std after a fresh clone:

```sh
cd contracts
forge install foundry-rs/forge-std --no-git
```

## Test

```sh
forge build
forge test -vv
```

## Deploy (Monad testnet, chain id 10143)

Deploy from a keystore account. Never pass a raw private key on the command line (shell history).

```sh
cast wallet import <keystore-name> --interactive   # once; prompts for the key and a password
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
forge script script/Deploy.s.sol --rpc-url monad_testnet --account <keystore-name> --broadcast
```

The script logs the deployed address. Deployed `MondayRegistry`: not deployed yet, record it here.

## Verify (Sourcify, shown on MonadVision)

```sh
forge verify-contract <address> src/MondayRegistry.sol:MondayRegistry \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```
