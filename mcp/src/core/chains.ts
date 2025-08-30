import { type Chain } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

// Using viem's built-in Ethereum chains
export const ethereumMainnet = mainnet;
export const ethereumSepolia = sepolia;

// Environment-based network configuration
const USE_TESTNET = process.env.USE_TESTNET === 'true' || process.env.NODE_ENV === 'development';

export const DEFAULT_RPC_URL = USE_TESTNET 
  ? (process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/') 
  : (process.env.ETH_RPC_URL || 'https://eth.llamarpc.com');

export function getDefaultChainId(): number {
  return USE_TESTNET ? 11155111 : 1; // Sepolia testnet or Ethereum mainnet
}

export const DEFAULT_CHAIN_ID = getDefaultChainId();

export const chainMap: Record<number, Chain> = {
  1: ethereumMainnet,
  11155111: ethereumSepolia,
};
function getNetworkNameMap(): Record<string, number> {
  return {
    'ethereum': 1,
    'eth': 1,
    'mainnet': 1,
    'sepolia': 11155111,
    'testnet': 11155111,
  };
}

export const rpcUrlMap: Record<number, string> = {
  1: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  11155111: process.env.SEPOLIA_RPC_URL || 'https://1rpc.io/sepolia',
};



/**
 * @param chainIdentifier
 * @returns
 * @throws
 */



export function resolveChainId(chainIdentifier: number | string): number {
  if (typeof chainIdentifier === 'number') {
    const supportedChainIds = [1, 11155111];
    if (!supportedChainIds.includes(chainIdentifier)) {
      throw new Error(`Unsupported chain ID: ${chainIdentifier}. Supported chains: Ethereum mainnet (1), Sepolia testnet (11155111)`);
    }
    return chainIdentifier;
  }
  const networkName = chainIdentifier.toLowerCase();
  const networkNameMap = getNetworkNameMap();
  if (networkName in networkNameMap) {
    return networkNameMap[networkName];
  }
  const parsedId = parseInt(networkName);
  if (!isNaN(parsedId)) {
    const supportedChainIds = [1, 11155111];
    if (!supportedChainIds.includes(parsedId)) {
      throw new Error(`Unsupported chain ID: ${parsedId}. Supported chains: Ethereum mainnet (1), Sepolia testnet (11155111)`);
    }
    return parsedId;
  }
  throw new Error(`Unsupported network: ${chainIdentifier}. Supported networks: ethereum, sepolia, mainnet, testnet`);
}



/**
 * @param chainIdentifier
 * @returns
 * @throws
 */



export function getChain(chainIdentifier: number | string = DEFAULT_CHAIN_ID): Chain {
  const chainId = resolveChainId(chainIdentifier);
  if (chainId === 1) {
    return ethereumMainnet;
  }
  if (chainId === 11155111) {
    return ethereumSepolia;
  }
  throw new Error(`Unsupported chain ID: ${chainIdentifier}. Supported chains: Ethereum mainnet (1), Sepolia testnet (11155111)`);
}



/**
 * @param chainIdentifier
 * @returns
 * @throws
 */



export function getRpcUrl(chainIdentifier: number | string = DEFAULT_CHAIN_ID): string {
  const chainId = resolveChainId(chainIdentifier);
  const supportedChainIds = [1, 11155111];
  if (!supportedChainIds.includes(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainIdentifier}. Supported chains: Ethereum mainnet (1), Sepolia testnet (11155111)`);
  }
  return rpcUrlMap[chainId];
}



/**
 * @returns
 */



export function getSupportedNetworks(): string[] {
  return ['ethereum', 'eth', 'mainnet', 'sepolia', 'testnet'];
}

// Helper function to get current network info
export function getCurrentNetwork(): { name: string; chainId: number; isTestnet: boolean } {
  const chainId = getDefaultChainId();
  const isTestnet = chainId === 11155111;
  return {
    name: isTestnet ? 'sepolia' : 'ethereum',
    chainId,
    isTestnet
  };
} 