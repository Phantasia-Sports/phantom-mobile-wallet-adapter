import React, {createContext, ReactNode, useCallback, useState} from 'react';
import * as nacl from 'tweetnacl';
import {BoxKeyPair} from 'tweetnacl';
import bs58 from 'bs58';
import {PublicKey, Transaction} from '@solana/web3.js';
import {CommonWallet} from './CommonWallet';

export const PhantomWalletName = 'Phantom';
export const PhantomWalletUrl = 'https://phantom.app/';
export const PhantomIconUrl =
  'https://www.gitbook.com/cdn-cgi/image/width=40,height=40,fit=contain,dpr=1,format=auto/https%3A%2F%2F3632261023-files.gitbook.io%2F~%2Ffiles%2Fv0%2Fb%2Fgitbook-legacy-files%2Fo%2Fspaces%252F-MVOiF6Zqit57q_hxJYp%252Favatar-1615495356537.png%3Fgeneration%3D1615495356841399%26alt%3Dmedia';

interface ReactNativeLinking {
  openURL: (url: string) => Promise<void>;
  addEventListener: (
    event: string,
    callback: (event: {url: string}) => void
  ) => {remove: () => void};
}

interface ReactLinkingEvent {
  remove: () => void;
}

export const PhantomContext = createContext<CommonWallet>({
  name: PhantomWalletName,
  url: PhantomWalletUrl,
  icon: PhantomIconUrl,
  readyState: 'Installed',
  publicKey: null as unknown as PublicKey,
  connecting: false,
  connected: false,

  wallets: [],
  autoConnect: true,
  disconnecting: false,
  wallet: {
    name: PhantomWalletName,
    url: PhantomWalletUrl,
    icon: PhantomIconUrl,
  },

  connect: () => {
    throw new Error('Not initialized!');
  },
  disconnect: () => {},
  signTransaction: (transaction: Transaction) => {
    throw new Error('Not initialized!');
  },
  signMessage: (message: Uint8Array) => {
    throw new Error('Not initialized!');
  },
});

enum RedirectRoutes {
  OnConnect = 'onConnect',
  OnSignTransaction = 'onSignTransaction',
  OnSignMessage = 'onSignMessage',
}

enum RequestRoutes {
  Connect = 'connect',
  SignTransaction = 'signTransaction',
  SignMessage = 'signMessage',
}

enum ResponseParams {
  DATA = 'data',
  NONCE = 'nonce',
  PHANTOM_ENCRYPTION_PUBLIC_KEY = 'phantom_encryption_public_key',
}

export enum Cluster {
  MAINNET = 'mainnet-beta',
  DEVNET = 'devnet',
}

export default function PhantomContextProvider({
  Linking,
  children,
  cluster,
  appUrl,
  protocol,
}: {
  Linking: ReactNativeLinking;
  children: ReactNode;
  cluster: Cluster;
  appUrl: string;
  protocol: string;
}) {
  const name = PhantomWalletName;
  const url = PhantomWalletUrl;
  const icon = PhantomIconUrl;
  const readyState = 'Installed';
  const connecting = false;
  const connected = true;

  const wallets: string[] = [];
  const autoConnect = true;
  const disconnecting = false;
  const wallet = {
    name: PhantomWalletName,
    url: PhantomWalletUrl,
    icon: PhantomIconUrl,
  };

  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [keypair, setKeypair] = useState<BoxKeyPair | null>(null);
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | null>(null);
  const [session, setSession] = useState<string | null>(null);

  type PhantomResponseHandler<T> = (params: URLSearchParams) => T;
  const waitForResponse = useCallback(
    <T extends unknown>(
      redirectRoute: string,
      handler: PhantomResponseHandler<T>
    ): Promise<T> => {
      let event: ReactLinkingEvent;
      const promise = new Promise<T>((resolve, reject) => {
        event = Linking.addEventListener('url', ({url}) => {
          const httpsUrl = url.replace(protocol, appUrl);
          const parsedUrl = new URL(httpsUrl);

          if (!new RegExp(redirectRoute).test(parsedUrl.pathname)) return;

          const params = parsedUrl.searchParams;
          if (params.get('errorCode')) {
            console.error('Error In Response', {params});
            reject(new Error('Error in Phantom Response'));
            return;
          }

          try {
            resolve(handler(params));
          } catch (e) {
            reject(e);
          }
        });
      });

      return promise.finally(() => {
        event.remove();
      });
    },
    [Linking]
  );

  const connect = useCallback(() => {
    const dAppKeypair = nacl.box.keyPair();
    const requestParams = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dAppKeypair.publicKey),
      cluster,
      app_url: appUrl,
      redirect_link: protocol + RedirectRoutes.OnConnect,
    });

    const onResponse: PhantomResponseHandler<void> = (
      responseParams: URLSearchParams
    ) => {
      const sharedSecretDapp = nacl.box.before(
        bs58.decode(
          responseParams.get(ResponseParams.PHANTOM_ENCRYPTION_PUBLIC_KEY)!
        ),
        dAppKeypair.secretKey
      );

      const connectData = decryptPayload(
        responseParams.get(ResponseParams.DATA)!,
        responseParams.get(ResponseParams.NONCE)!,
        sharedSecretDapp
      );

      setKeypair(dAppKeypair);
      setSharedSecret(sharedSecretDapp);
      setSession(connectData.session);
      setPublicKey(new PublicKey(connectData.public_key));
    };
    const resPromise = waitForResponse(RedirectRoutes.OnConnect, onResponse);

    const url = buildUrl(RequestRoutes.Connect, requestParams);
    Linking.openURL(url);
    return resPromise;
  }, [Linking, cluster, waitForResponse]);

  const signTransaction = useCallback(
    (transaction: Transaction): Promise<Transaction> => {
      const serializedTransaction = bs58.encode(
        transaction.serialize({
          requireAllSignatures: false,
        })
      );

      if (!sharedSecret || !keypair || !sharedSecret)
        throw new Error('Wallet is not connected');

      const payload = {
        session,
        transaction: serializedTransaction,
      };
      const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);
      const requestParams = new URLSearchParams({
        dapp_encryption_public_key: bs58.encode(keypair.publicKey),
        nonce: bs58.encode(nonce),
        redirect_link: protocol + RedirectRoutes.OnSignTransaction,
        payload: bs58.encode(encryptedPayload),
      });
      const url = buildUrl(RequestRoutes.SignTransaction, requestParams);

      const onResponse: PhantomResponseHandler<Transaction> = (
        responseParams: URLSearchParams
      ) => {
        const signTransactionData = decryptPayload(
          responseParams.get(ResponseParams.DATA)!,
          responseParams.get(ResponseParams.NONCE)!,
          sharedSecret
        );

        return Transaction.from(bs58.decode(signTransactionData.transaction));
      };
      const promise = waitForResponse(
        RedirectRoutes.OnSignTransaction,
        onResponse
      );

      Linking.openURL(url);
      return promise;
    },
    [Linking, keypair, session, sharedSecret, waitForResponse]
  );

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!sharedSecret || !keypair || !sharedSecret)
        throw new Error('Wallet is not connected');

      const payload = {
        session,
        message: bs58.encode(message),
      };

      const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

      const requestParams = new URLSearchParams({
        dapp_encryption_public_key: bs58.encode(keypair.publicKey),
        nonce: bs58.encode(nonce),
        redirect_link: protocol + RedirectRoutes.OnSignMessage,
        payload: bs58.encode(encryptedPayload),
      });

      const responseHandler = (responseParams: URLSearchParams) => {
        const signMessageData = decryptPayload(
          responseParams.get(ResponseParams.DATA)!,
          responseParams.get(ResponseParams.NONCE)!,
          sharedSecret
        ) as {signature: string};

        const {signature} = signMessageData;
        return bs58.decode(signature);
      };
      const promise = waitForResponse(
        RedirectRoutes.OnSignMessage,
        responseHandler
      );

      const url = buildUrl(RequestRoutes.SignMessage, requestParams);
      Linking.openURL(url);

      return promise;
    },
    [Linking, keypair, session, sharedSecret, waitForResponse]
  );

  function disconnect() {
    setPublicKey(null);
    setSession(null);
    setKeypair(null);
    setSharedSecret(null);
  }

  return (
    <PhantomContext.Provider
      value={{
        name,
        url,
        icon,
        readyState,
        connected,
        connecting,
        wallets,
        autoConnect,
        disconnecting,
        wallet,
        publicKey: publicKey as PublicKey,
        connect,
        disconnect,
        signTransaction,
        signMessage,
      }}
    >
      {children}
    </PhantomContext.Provider>
  );
}

const buildUrl = (path: string, params: URLSearchParams) =>
  `${PhantomWalletUrl}ul/v1/${path}?${params.toString()}`;

function decryptPayload(
  data: string,
  nonce: string,
  sharedSecret: Uint8Array
): any {
  const decryptedData = nacl.box.open.after(
    bs58.decode(data),
    bs58.decode(nonce),
    sharedSecret
  );
  if (!decryptedData) {
    throw new Error('Unable to decrypt data');
  }
  return JSON.parse(Buffer.from(decryptedData).toString('utf8'));
}

function encryptPayload(
  payload: any,
  sharedSecret: Uint8Array
): [Uint8Array, Uint8Array] {
  const nonce = nacl.randomBytes(24);

  const encryptedPayload = nacl.box.after(
    Buffer.from(JSON.stringify(payload)),
    nonce,
    sharedSecret
  );

  return [nonce, encryptedPayload];
}
