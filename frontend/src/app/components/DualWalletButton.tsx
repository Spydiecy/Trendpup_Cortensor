'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import Image from 'next/image';

export default function EthereumWalletButton() {
  const { address: ethAddress, isConnected: isEthConnected } = useAccount();
  const chainId = useChainId();

  return (
    <div className="flex flex-col gap-2">
      {/* Ethereum Network Display */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        <div className="flex-1 py-2 px-3 rounded-md text-sm font-medium bg-white text-blue-600 shadow-sm flex items-center justify-center">
          <Image src="/eth.svg" alt="Ethereum" width={16} height={16} className="mr-1" />
          Ethereum
        </div>
      </div>

      {/* Wallet Button */}
      <div className="flex justify-center">
        <ConnectButton chainStatus="none" />
      </div>

      {/* Connection Status */}
      {isEthConnected && ethAddress && (
        <div className="text-xs text-gray-600 text-center">
          <div className="font-mono bg-gray-100 px-2 py-1 rounded">
            {ethAddress.slice(0, 8)}...{ethAddress.slice(-8)}
          </div>
          <div className="mt-1">
            {chainId === 11155111 ? 'Sepolia Testnet' : 'Wrong Network'}
          </div>
        </div>
      )}
    </div>
  );
}
