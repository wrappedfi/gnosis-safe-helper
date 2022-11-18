import Safe, { SafeTransactionOptionalProps } from "@gnosis.pm/safe-core-sdk";
import EthersAdapter from "@gnosis.pm/safe-ethers-lib";
import { SafeEthersSigner, SafeService } from "@gnosis.pm/safe-ethers-adapters";
import SafeServiceClient, {
  ProposeTransactionProps,
  SafeDelegateConfig,
  SafeDelegateResponse,
  SafeMultisigTransactionResponse,
} from "@gnosis.pm/safe-service-client";

import * as ethers from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import {
  MetaTransactionData,
  SafeTransaction,
  SafeTransactionDataPartial,
} from "@gnosis.pm/safe-core-sdk-types";

interface SafeHelperOptions {
  testing?: boolean;
  providerUrl?: string;
  txServiceUrl?: string;
}

export class SafeHelper {
  safeAddress: string;
  txServiceUrl: string;
  defaultSignerKey?: string;
  provider: Provider;
  service: SafeService;

  constructor(safeAddress: string, options: SafeHelperOptions | undefined) {
    const isTesting = options?.testing;
    const normalizedOptions = Object.assign(
      // set defaults
      {
        txServiceUrl: isTesting
          ? "https://safe-transaction.goerli.gnosis.io"
          : "https://safe-transaction.gnosis.io/api/v1",
      },
      // override defaults
      { ...(options || {}) }
    );

    this.safeAddress = safeAddress;
    this.provider = normalizedOptions?.providerUrl
      ? ethers.getDefaultProvider(normalizedOptions.providerUrl)
      : ethers.getDefaultProvider(isTesting ? "goerli" : "mainnet");
    this.txServiceUrl = normalizedOptions.txServiceUrl;
    this.service = new SafeService(this.txServiceUrl);
  }

  setDefaultSignerKey(signerKey: string) {
    this.defaultSignerKey = signerKey;
  }

  _resolveSignerKey(key?: string) {
    const signerKey = key || this.defaultSignerKey;
    if (!signerKey) {
      throw new Error("Pass a key or set a default signer");
    }
    return signerKey;
  }

  _resolveSigner(key?: string) {
    const signerKey = this._resolveSignerKey(key);
    const signer = new ethers.Wallet(signerKey, this.provider);
    return signer;
  }

  _getEthAdapter(key?: string) {
    const signer = this._resolveSigner(key);
    const ethAdapter = new EthersAdapter({ ethers, signer });
    return ethAdapter;
  }

  _getTxServiceClient(key?: string) {
    const serviceClient = new SafeServiceClient({
      ethAdapter: this._getEthAdapter(key),
      txServiceUrl: this.txServiceUrl,
    });
    return serviceClient;
  }

  async _getSafeClient(key?: string) {
    const safeClient = await Safe.create({
      ethAdapter: this._getEthAdapter(key),
      safeAddress: this.safeAddress,
    });
    return safeClient;
  }

  async _getSafeSignerFromKey(key?: string) {
    const safe = await this._getSafeClient(key);
    const safeSigner = new SafeEthersSigner(safe, this.service, this.provider);
    return safeSigner;
  }

  // TODO getOwners
  // TODO addOwner
  // TODO removeOwner

  async getDelegates(): Promise<SafeDelegateResponse[]> {
    const safeDelegateListResponse =
      await this._getTxServiceClient().getSafeDelegates(this.safeAddress);
    return safeDelegateListResponse.results;
  }

  async addDelegate(
    delegateConfig: Omit<SafeDelegateConfig, "safe" | "signer">,
    ownerKey?: string
  ) {
    const normalizedDelegateConfig = Object.assign(delegateConfig, {
      delegate: ethers.utils.getAddress(delegateConfig.delegate),
    });
    const serviceClient = this._getTxServiceClient(ownerKey);
    const newDelegate = await serviceClient.addSafeDelegate({
      safe: this.safeAddress,
      signer: this._resolveSigner(ownerKey),
      ...normalizedDelegateConfig,
    });
    return newDelegate;
  }

  async removeDelegate(delegateAddressToRemove: string, ownerKey?: string) {
    const normalizedAddress = ethers.utils.getAddress(delegateAddressToRemove);
    const serviceClient = this._getTxServiceClient(ownerKey);
    const activeDelegates = await this.getDelegates();
    const foundDelegate = activeDelegates.find(
      (entry) =>
        entry.delegate.toLowerCase() === normalizedAddress.toLowerCase()
    );
    if (!foundDelegate) {
      throw new Error(`No delegate found with address ${normalizedAddress}`);
    }
    await serviceClient.removeSafeDelegate({
      safe: this.safeAddress,
      signer: this._resolveSigner(ownerKey),
      ...foundDelegate,
    });
    return true;
  }

  async removeAllDelegates(ownerKey?: string) {
    const serviceClient = this._getTxServiceClient(ownerKey);
    await serviceClient.removeAllSafeDelegates(
      this.safeAddress,
      this._resolveSigner(ownerKey)
    );
    return true;
  }

  async getPendingTransactions(
    key?: string
  ): Promise<SafeMultisigTransactionResponse[]> {
    const serviceClient = this._getTxServiceClient(key);
    const pendingSafeTransactionListResponse =
      await serviceClient.getPendingTransactions(this.safeAddress);
    return pendingSafeTransactionListResponse.results;
  }

  async createTransaction(
    transaction: SafeTransactionDataPartial,
    key?: string
  ): Promise<SafeTransaction> {
    const safe = await this._getSafeClient(key);
    const safeTx = await safe.createTransaction(transaction);
    return safeTx;
  }

  async createSignedTransaction(
    transaction: SafeTransactionDataPartial,
    key?: string
  ): Promise<SafeTransaction> {
    const safe = await this._getSafeClient(key);
    const safeTx = await this.createTransaction(transaction, key);
    const safeTxHash = await safe.getTransactionHash(safeTx);
    const signature = await safe.signTransactionHash(safeTxHash);
    safeTx.addSignature(signature);
    return safeTx;
  }

  async proposeTransaction(
    args: { safeTx: SafeTransaction; origin?: string },
    key?: string
  ) {
    const { safeTx, origin } = args;
    const safe = await this._getSafeClient(key);
    const signer = this._resolveSigner(key);
    const safeTxHash = await safe.getTransactionHash(safeTx);
    const transactionConfig: ProposeTransactionProps = {
      safeAddress: this.safeAddress,
      safeTransaction: safeTx,
      safeTxHash,
      senderAddress: signer.address,
      ...(origin ? { origin } : {}),
    };
    const txService = this._getTxServiceClient(key);
    await txService.proposeTransaction(transactionConfig);
    return safeTxHash;
  }

  async createAndProposeSignedTransaction(
    args: { transaction: SafeTransactionDataPartial; origin?: string },
    creatorKey?: string,
    proposerKey?: string
  ) {
    const { transaction, origin } = args;
    const safeTx = await this.createSignedTransaction(transaction, creatorKey);
    const safeTxHash = await this.proposeTransaction(
      { safeTx, origin },
      proposerKey || creatorKey
    );
    return safeTxHash;
  }

  async createRejectionTransaction(
    safeTxHash: string,
    key?: string
  ): Promise<string> {
    const pendingTransactions = await this.getPendingTransactions(key);
    const indexOfPendingTx = pendingTransactions.findIndex(
      (entry: SafeMultisigTransactionResponse) =>
        entry.safeTxHash === safeTxHash
    );
    if (indexOfPendingTx === -1) {
      throw new Error(`No safe transaction found with hash ${safeTxHash}`);
    }
    const safeTxToReject = pendingTransactions[indexOfPendingTx];
    const safe = await this._getSafeClient(key);
    const rejectSafeTx = await safe.createRejectionTransaction(
      safeTxToReject.nonce
    );
    const rejectSafeTxHash = await safe.getTransactionHash(rejectSafeTx);
    return rejectSafeTxHash;
  }

  async approveTransaction(safeTxHash: string, key?: string) {
    const safe = await this._getSafeClient(key);
    return safe.approveTransactionHash(safeTxHash);
  }

  async executeTransaction(safeTxHash: string, key?: string) {
    const safe = await this._getSafeClient(key);
    const pendingTransactions = await this.getPendingTransactions(key);
    const indexOfPendingTx = pendingTransactions.findIndex(
      (entry: SafeMultisigTransactionResponse) =>
        entry.safeTxHash === safeTxHash
    );
    if (indexOfPendingTx === -1) {
      throw new Error(`No safe transaction found with hash ${safeTxHash}`);
    }
    const { to, data, value, operation, ...options } =
      pendingTransactions[indexOfPendingTx];
    const transactionData: MetaTransactionData = {
      to,
      data: data || "0x",
      value,
      operation,
    };
    const optionalProps: SafeTransactionOptionalProps = {
      ...options,
      gasPrice: Number(options.gasPrice),
    };
    const safeTx = await safe.createTransaction(
      [transactionData],
      optionalProps
    );
    return safe.executeTransaction(safeTx);
  }
}
