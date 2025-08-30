import { formatEther, formatUnits, type Address } from 'viem';
import { getPublicClient } from './clients.js';
import { resolveAddress } from './utils.js';
import { getCurrentNetwork } from '../chains.js';

const erc20Abi = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ type: 'address', name: 'account' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

/**
 * @param addressOrEns
 * @param network
 * @returns
 */
export async function getNativeBalance(
  addressOrEns: Address | string,
  network: string = getCurrentNetwork().name
): Promise<{ wei: bigint; formatted: string; symbol: string }> {
  const address = await resolveAddress(addressOrEns, network);
  const client = getPublicClient(network);
  const balance = await client.getBalance({ address });
  
  // Ethereum uses ETH for all networks (mainnet and testnet)
  const symbol = 'ETH';
  
  return {
    wei: balance,
    formatted: formatEther(balance),
    symbol
  };
}



/**
 * @param tokenAddressOrEns
 * @param ownerAddressOrEns
 * @param network
 * @returns
 */
export async function getERC20Balance(
  tokenAddressOrEns: string,
  ownerAddressOrEns: string,
  network = getCurrentNetwork().name
): Promise<{
  raw: bigint;
  formatted: string;
  token: {
    symbol: string;
    decimals: number;
  }
}> {
  const tokenAddress = await resolveAddress(tokenAddressOrEns, network);
  const ownerAddress = await resolveAddress(ownerAddressOrEns, network);
  const publicClient = getPublicClient(network);
  const [balance, symbol, decimals] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ownerAddress]
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol'
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals'
    })
  ]);
  return {
    raw: balance,
    formatted: formatUnits(balance, decimals),
    token: {
      symbol,
      decimals
    }
  };
}