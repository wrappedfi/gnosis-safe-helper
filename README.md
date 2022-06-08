# Gnosis SafeHelper

A library for programmatic administration of a [Gnosis Safe](https://gnosis-safe.io/).

## Installation

Install using your package manager of choice.

```bash
$ npm install gnosis-safe-helper
OR
$ yarn add gnosis-safe-helper
```

## Usage

Below is an example of how to create, approve, and execute a transaction on a `2 of n` Safe. It is assumed that the safe has a [delegate key](https://help.gnosis-safe.io/en/articles/5809867-what-is-a-delegate-key) and two owner keys.

```typescript
import { SafeHelper } from "gnosis-safe-helper";

// Safe and network vars
const safeAddress = "0xB91CA1df240DEE594deDa2654222d22B2d3a9FDC";
const providerUrl = process.env.JSON_RPC;
const txServiceUrl = "https://safe-transaction.gnosis.io";

// Signer keys
const delegateSignerKey = process.env.DELEGATE_SIGNER_PRIVKEY;
const primarySignerKey = process.env.PRIMARY_SIGNER_PRIVKEY;
const secondarySignerKey = process.env.SECONDARY_SIGNER_PRIVKEY;

const run = async () => {
  // Create a SafeHelper instance
  const safeHelper = new SafeHelper(safeAddress, {
    providerUrl,
    txServiceUrl,
  });

  // Structure a gnosis safe transaction (as delegate)
  const transaction = {
    to: "0x<address>",
    value: "<eth_value_in_wei>",
    data: "0x<data>",
  };
  const safeTx = await safeHelper.createTransaction(
    transaction,
    delegateSignerKey
  );

  // Propose the transaction (as delegate)
  const safeTxHash = await safeHelper.proposeTransaction(
    { safeTx, origin: "Sent via GnosisSafeHelper" },
    delegateSignerKey
  );

  // Give 1st approval (as primary signer)
  const firstApproval = await safeHelper.approveTransaction(
    safeTxHash,
    primarySignerKey
  );
  await firstApproval.transactionResponse?.wait();

  // Give 2nd approval (as secondary signer)
  const secondApproval = await safeHelper.approveTransaction(
    safeTxHash,
    secondarySignerKey
  );
  await secondApproval.transactionResponse?.wait();

  // Execute the fully signed transaction (as delegate)
  const execution = await safeHelper.executeTransaction(
    safeTxHash,
    delegateSignerKey
  );
  await execution.transactionResponse?.wait();
};

run();
```
