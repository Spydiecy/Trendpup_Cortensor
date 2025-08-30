import { getCurrentNetwork } from '../chains.js';
import { type Address, type Hash, type TransactionReceipt, type EstimateGasParameters } from 'viem';
import { getPublicClient } from './clients.js';



export async function getTransaction(hash: Hash, network = getCurrentNetwork().name) {
  const client = getPublicClient(network);
  return await client.getTransaction({ hash });
}



export async function getTransactionReceipt(hash: Hash, network = getCurrentNetwork().name): Promise<TransactionReceipt> {
  const client = getPublicClient(network);
  return await client.getTransactionReceipt({ hash });
}



export async function getTransactionCount(address: Address, network = getCurrentNetwork().name): Promise<number> {
  const client = getPublicClient(network);
  const count = await client.getTransactionCount({ address });
  return Number(count);
}



export async function estimateGas(params: EstimateGasParameters, network = getCurrentNetwork().name): Promise<bigint> {
  const client = getPublicClient(network);
  return await client.estimateGas(params);
}



export async function getChainId(network = getCurrentNetwork().name): Promise<number> {
  const client = getPublicClient(network);
  const chainId = await client.getChainId();
  return Number(chainId);
} 