import "dotenv/config";
import test from "ava";
import { SafeHelper } from "..";
import { ethers } from "ethers";

let safeHelper: SafeHelper;
let safeAddress: string;
let primarySigner: ethers.Wallet,
  secondarySigner: ethers.Wallet,
  delegateSigner: ethers.Wallet;

test.before(async () => {
  if (!process.env.SAFE_ADDRESS) {
    throw new Error("Env var not set: SAFE_ADDRESS");
  }
  if (!process.env.RPC_URL) {
    throw new Error("Env var not set: RPC_URL");
  }
  safeAddress = process.env.SAFE_ADDRESS;
  safeHelper = new SafeHelper(safeAddress, {
    testing: true,
    providerUrl: process.env.RPC_URL,
    txServiceUrl: "https://safe-transaction.rinkeby.gnosis.io",
  });

  if (!process.env.OWNER_1_PRIVATE_KEY) {
    throw new Error("Env var not set: OWNER_1_PRIVATE_KEY");
  }
  primarySigner = new ethers.Wallet(process.env.OWNER_1_PRIVATE_KEY);

  if (!process.env.OWNER_2_PRIVATE_KEY) {
    throw new Error("Env var not set: OWNER_2_PRIVATE_KEY");
  }
  secondarySigner = new ethers.Wallet(process.env.OWNER_2_PRIVATE_KEY);

  if (!process.env.DELEGATE_PRIVATE_KEY) {
    throw new Error("Env var not set: DELEGATE_PRIVATE_KEY");
  }
  delegateSigner = new ethers.Wallet(process.env.DELEGATE_PRIVATE_KEY);
});

test.beforeEach(async () => {
  safeHelper.setDefaultSignerKey(primarySigner.privateKey);
  await safeHelper.removeAllDelegates();
});

test("e2e", async (t) => {
  // Specify test timeout
  t.timeout(120000); // 2 minutes

  // Set delegate address
  await safeHelper.addDelegate({
    label: "Temporary Delegate",
    delegate: delegateSigner.address,
  });

  // Structure transaction
  const safeTx = await safeHelper.createTransaction(
    {
      to: "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF", // weird "f" address
      value: ethers.utils.parseUnits("0.000666").toString(), // spooky amount
      data: "0x", // empty data... i think?
    },
    delegateSigner.privateKey
  );

  // Propose transaction (delegate)
  const safeTxHash = await safeHelper.proposeTransaction(
    { safeTx, origin: "Sent via GnosisSafeHelper" },
    delegateSigner.privateKey
  );
  console.debug("Proposed safeTx:", safeTxHash);

  // Give 1st approval (owner 1)
  const firstApprovalResult = await safeHelper.approveTransaction(
    safeTxHash,
    primarySigner.privateKey
  );
  await firstApprovalResult.transactionResponse?.wait();
  console.debug("1st approval tx:", firstApprovalResult.hash);

  // Give 2nd approval (owner 2)
  const secondaryApprovalResult = await safeHelper.approveTransaction(
    safeTxHash,
    secondarySigner.privateKey
  );
  await secondaryApprovalResult.transactionResponse?.wait();
  console.debug("2nd approval tx:", secondaryApprovalResult.hash);

  // Execute (delegate)
  const executeResult = await safeHelper.executeTransaction(
    safeTxHash,
    delegateSigner.privateKey
  );
  await executeResult.transactionResponse?.wait();
  console.debug("Execute tx:", executeResult.hash);
  t.pass();
});
