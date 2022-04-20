import {PublicKey, Transaction} from '@solana/web3.js';

export interface CommonWallet {
  name: string;
  url: string;
  icon: string;
  readyState: string;
  publicKey: PublicKey;
  connecting: boolean;
  connected: boolean;

  wallets: string[];
  autoConnect: boolean;
  disconnecting: boolean;
  wallet: {
    name: string;
    url: string;
    icon: string;
  };

  connect?: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (transaction: Transaction) => Promise<Transaction | Buffer>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}
