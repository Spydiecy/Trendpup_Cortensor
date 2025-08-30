import { getCurrentNetwork } from '../chains.js';
import { type Hash, type Block } from 'viem';
import { getPublicClient } from './clients.js';



export async function getBlockNumber(network = getCurrentNetwork().name): Promise<bigint> {
  const client = getPublicClient(network);
  return await client.getBlockNumber();
}



export async function getBlockByNumber(
  blockNumber: number, 
  network = getCurrentNetwork().name
): Promise<Block> {
  const client = getPublicClient(network);
  return await client.getBlock({ blockNumber: BigInt(blockNumber) });
}



export async function getBlockByHash(
  blockHash: Hash, 
  network = getCurrentNetwork().name
): Promise<Block> {
  const client = getPublicClient(network);
  return await client.getBlock({ blockHash });
}



export async function getLatestBlock(network = getCurrentNetwork().name): Promise<Block> {
  const client = getPublicClient(network);
  return await client.getBlock();
} 