import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupportedNetworks, getRpcUrl, getCurrentNetwork } from "./chains.js";
import * as services from "./services/index.js";
import { type Address, type Hex, type Hash } from 'viem';



/**
 * @param server
 */



export function registerBlockchainTools(server: McpServer) {
  const currentNetwork = getCurrentNetwork();
  const defaultNetworkDesc = `Defaults to ${currentNetwork.name} (${currentNetwork.isTestnet ? 'testnet' : 'mainnet'}) based on USE_TESTNET environment variable.`;

  server.tool(
    "get_chain_info",
    "Get information about Ethereum networks (mainnet and Sepolia testnet)",
    {
      network: z.string().optional().describe(`Network name ('ethereum', 'sepolia', 'mainnet', 'testnet') or chain ID. ${defaultNetworkDesc}`)
    },
    async ({ network = currentNetwork.name }) => {
      try {
        const chainId = await services.getChainId(network);
        const blockNumber = await services.getBlockNumber(network);
        const rpcUrl = getRpcUrl(network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              network,
              chainId,
              blockNumber: blockNumber.toString(),
              rpcUrl
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching chain info: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_supported_networks",
    "Get a list of supported blockchain networks (Ethereum mainnet and Sepolia testnet)",
    {},
    async () => {
      try {
        const networks = getSupportedNetworks();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              supportedNetworks: networks
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching supported networks: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_block_by_number",
    "Get a block by its block number",
    {
      blockNumber: z.number().describe("The block number to fetch"),
      network: z.string().optional().describe(`Network name or chain ID. Supports Ethereum mainnet and Sepolia testnet. Defaults to ${getCurrentNetwork().name}.`)
    },
    async ({ blockNumber, network = "ethereum" }) => {
      try {
        const block = await services.getBlockByNumber(blockNumber, network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson(block)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching block ${blockNumber}: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_latest_block",
    "Get the latest block from the blockchain",
    {
      network: z.string().optional().describe(`Network name or chain ID. Supports Ethereum mainnet and Sepolia testnet. Defaults to ${getCurrentNetwork().name}.`)
    },
    async ({ network = "ethereum" }) => {
      try {
        const block = await services.getLatestBlock(network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson(block)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching latest block: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_balance",
    "Get the native token balance (ETH) for an address", 
    {
      address: z.string().describe("The wallet address or ENS name (e.g., '0x1234...' or 'example.eth') to check the balance for"),
      network: z.string().optional().describe(`Network name. Supports Ethereum mainnet and Sepolia testnet. Defaults to ${getCurrentNetwork().name}.`)
    },
    async ({ address, network = "ethereum" }) => {
      try {
        const balance = await services.getNativeBalance(address, network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address,
              network,
              wei: balance.wei.toString(),
              formatted: balance.formatted,
              symbol: balance.symbol
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_erc20_balance",
    "Get the ERC20 token balance of a blockchain address",
    {
      tokenAddress: z.string().describe("The ERC20 token contract address"),
      holderAddress: z.string().describe("The address to check balance for"),
      network: z.string().optional().describe("Network name or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ tokenAddress, holderAddress, network = "ethereum" }) => {
      try {
        const balance = await services.getERC20Balance(
          tokenAddress,
          holderAddress,
          network
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              holderAddress,
              tokenAddress,
              network,
              balance: {
                raw: balance.raw.toString(),
                formatted: balance.formatted,
                symbol: balance.token.symbol,
                decimals: balance.token.decimals
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching ERC20 balance for ${holderAddress}: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_token_balance",
    "Get the balance of an ERC20 token for an address",
    {
      tokenAddress: z.string().describe("The contract address or ENS name of the ERC20 token"),
      ownerAddress: z.string().describe("The wallet address or ENS name to check the balance for (e.g., '0x1234...' or 'example.eth')"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ tokenAddress, ownerAddress, network = "ethereum" }) => {
      try {
        const balance = await services.getERC20Balance(tokenAddress, ownerAddress, network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              tokenAddress,
              owner: ownerAddress,
              network,
              raw: balance.raw.toString(),
              formatted: balance.formatted,
              symbol: balance.token.symbol,
              decimals: balance.token.decimals
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching token balance: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_transaction",
    "Get detailed information about a specific transaction by its hash. Includes sender, recipient, value, data, and more.",
    {
      hash: z.string().describe("The transaction hash to look up (e.g., '0x1234...')"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ hash, network = "ethereum" }) => {
      try {
        const tx = await services.getTransaction(hash as Hash, network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson(tx)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching transaction ${hash}: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_transaction_receipt",
    "Get a transaction receipt by its hash",
    {
      hash: z.string().describe("The transaction hash to look up"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ hash, network = "ethereum" }) => {
      try {
        const receipt = await services.getTransactionReceipt(hash as Hash, network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson(receipt)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching transaction receipt ${hash}: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "estimate_gas",
    "Estimate the gas cost for a transaction",
    {
      to: z.string().describe("The recipient address"),
      value: z.string().optional().describe("The amount of native token to send (e.g., '0.1' ETH)"),
      data: z.string().optional().describe("The transaction data as a hex string"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ to, value, data, network = "ethereum" }) => {
      try {
        const params: any = { to: to as Address };
        if (value) {
          params.value = services.helpers.parseEther(value);
        }
        if (data) {
          params.data = data as `0x${string}`;
        }
        const gas = await services.estimateGas(params, network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              network,
              estimatedGas: gas.toString()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error estimating gas: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "transfer_native",
    "Transfer native tokens (ETH) to an address",
    {
      privateKey: z.string().optional().describe("Private key of the sender account in hex format (with or without 0x prefix). If not provided, reads from WALLET_PRIVATE_KEY environment variable. SECURITY: This is used only for transaction signing and is not stored."),
      to: z.string().describe("The recipient address or ENS name (e.g., '0x1234...' or 'example.eth')"),
      amount: z.string().describe("Amount to send in native token, as a string (e.g., '0.1')"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ privateKey, to, amount, network = "ethereum" }) => {
      try {
        const key = privateKey || process.env.WALLET_PRIVATE_KEY;
        if (!key) {
          throw new Error("Private key not provided and WALLET_PRIVATE_KEY environment variable not set");
        }
        const txHash = await services.transferNative(key, to, amount, network);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              success: true,
              txHash,
              to,
              amount,
              network
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error transferring native tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "transfer_erc20",
    "Transfer ERC20 tokens to another address",
    {
      privateKey: z.string().optional().describe("Private key of the sending account (this is used for signing and is never stored). If not provided, reads from WALLET_PRIVATE_KEY environment variable."),
      tokenAddress: z.string().describe("The address of the ERC20 token contract"),
      toAddress: z.string().describe("The recipient address"),
      amount: z.string().describe("The amount of tokens to send (in token units, e.g., '10' for 10 tokens)"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ privateKey, tokenAddress, toAddress, amount, network = "ethereum" }) => {
      try {
        const key = privateKey || process.env.WALLET_PRIVATE_KEY;
        if (!key) {
          throw new Error("Private key not provided and WALLET_PRIVATE_KEY environment variable not set");
        }
        const formattedKey = key.startsWith('0x') 
          ? key as `0x${string}` 
          : `0x${key}` as `0x${string}`;
        const result = await services.transferERC20(
          tokenAddress as Address, 
          toAddress as Address, 
          amount,
          formattedKey,
          network
        );
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              success: true,
              txHash: result.txHash,
              network,
              tokenAddress,
              recipient: toAddress,
              amount: result.amount.formatted,
              symbol: result.token.symbol
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error transferring ERC20 tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "approve_token_spending",
    "Approve another address (like a DeFi protocol or exchange) to spend your ERC20 tokens. This is often required before interacting with DeFi protocols.",
    {
      privateKey: z.string().describe("Private key of the token owner account in hex format (with or without 0x prefix). SECURITY: This is used only for transaction signing and is not stored."),
      tokenAddress: z.string().describe("The contract address of the ERC20 token to approve for spending"),
      spenderAddress: z.string().describe("The contract address being approved to spend your tokens (e.g., a DEX or lending protocol)"),
      amount: z.string().describe("The amount of tokens to approve in token units, not wei (e.g., '1000' to approve spending 1000 tokens). Use a very large number for unlimited approval."),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ privateKey, tokenAddress, spenderAddress, amount, network = "ethereum" }) => {
      try {
        const formattedKey = privateKey.startsWith('0x') 
          ? privateKey as `0x${string}` 
          : `0x${privateKey}` as `0x${string}`;
        const result = await services.approveERC20(
          tokenAddress as Address, 
          spenderAddress as Address, 
          amount,
          formattedKey,
          network
        );
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              success: true,
              txHash: result.txHash,
              network,
              tokenAddress,
              spender: spenderAddress,
              amount: result.amount.formatted,
              symbol: result.token.symbol
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error approving token spending: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "transfer_token",
    "Transfer ERC20 tokens to an address",
    {
      privateKey: z.string().describe("Private key of the sender account in hex format (with or without 0x prefix). SECURITY: This is used only for transaction signing and is not stored."),
      tokenAddress: z.string().describe("The contract address or ENS name of the ERC20 token to transfer"),
      toAddress: z.string().describe("The recipient address or ENS name that will receive the tokens (e.g., '0x1234...' or 'example.eth')"),
      amount: z.string().describe("Amount of tokens to send as a string (e.g., '100' for 100 tokens). This will be adjusted for the token's decimals."),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ privateKey, tokenAddress, toAddress, amount, network = "ethereum" }) => {
      try {
        const result = await services.transferERC20(
          tokenAddress,
          toAddress,
          amount,
          privateKey,
          network
        );
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              success: true,
              txHash: result.txHash,
              tokenAddress,
              toAddress,
              amount: result.amount.formatted,
              symbol: result.token.symbol,
              network
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error transferring tokens: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "read_contract",
    "Read data from a smart contract by calling a view/pure function. This doesn't modify blockchain state and doesn't require gas or signing.",
    {
      contractAddress: z.string().describe("The address of the smart contract to interact with"),
      abi: z.array(z.any()).describe("The ABI (Application Binary Interface) of the smart contract function, as a JSON array"),
      functionName: z.string().describe("The name of the function to call on the contract (e.g., 'balanceOf')"),
      args: z.array(z.any()).optional().describe("The arguments to pass to the function, as an array (e.g., ['0x1234...'])"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ contractAddress, abi, functionName, args = [], network = "ethereum" }) => {
      try {
        const parsedAbi = typeof abi === 'string' ? JSON.parse(abi) : abi;
        const client = services.getPublicClient(network);
        const result = await client.readContract({
          address: contractAddress as Address,
          abi: parsedAbi,
          functionName,
          args
        });
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson(result)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error reading contract: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "write_contract",
    "Write data to a smart contract by calling a state-changing function. This modifies blockchain state and requires gas payment and transaction signing.",
    {
      contractAddress: z.string().describe("The address of the smart contract to interact with"),
      abi: z.array(z.any()).describe("The ABI (Application Binary Interface) of the smart contract function, as a JSON array"),
      functionName: z.string().describe("The name of the function to call on the contract (e.g., 'transfer')"),
      args: z.array(z.any()).describe("The arguments to pass to the function, as an array (e.g., ['0x1234...', '1000000000000000000'])"),
      privateKey: z.string().describe("Private key of the sending account in hex format (with or without 0x prefix). SECURITY: This is used only for transaction signing and is not stored."),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ contractAddress, abi, functionName, args, privateKey, network = "ethereum" }) => {
      try {
        const parsedAbi = typeof abi === 'string' ? JSON.parse(abi) : abi;
        const contractParams: Record<string, any> = {
          address: contractAddress as Address,
          abi: parsedAbi,
          functionName,
          args
        };
        const txHash = await services.writeContract(
          privateKey as Hex, 
          contractParams, 
          network
        );
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              network,
              transactionHash: txHash,
              message: "Contract write transaction sent successfully"
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error writing to contract: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "is_contract",
    "Check if an address is a smart contract or an externally owned account (EOA)",
    {
      address: z.string().describe("The wallet or contract address or ENS name to check (e.g., '0x1234...' or 'example.eth')"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ address, network = "ethereum" }) => {
      try {
        const isContract = await services.isContract(address, network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address,
              network,
              isContract,
              type: isContract ? "Contract" : "Externally Owned Account (EOA)"
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking if address is a contract: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_token_info",
    "Get comprehensive information about an ERC20 token including name, symbol, decimals, total supply, and other metadata. Use this to analyze any token on supported blockchains.",
    {
      tokenAddress: z.string().describe("The contract address of the ERC20 token"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ tokenAddress, network = "ethereum" }) => {
      try {
        const tokenInfo = await services.getERC20TokenInfo(tokenAddress as Address, network);
        
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              address: tokenAddress,
              network,
              ...tokenInfo
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching token info: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_token_balance_erc20",
    "Get ERC20 token balance for an address",
    {
      tokenAddress: z.string().describe("The ERC20 token contract address"),
      ownerAddress: z.string().describe("The address to check balance for"),
      network: z.string().optional().describe("Network name (ethereum, sepolia) or chain ID. Defaults to Ethereum mainnet.")
    },
    async ({ tokenAddress, ownerAddress, network = "ethereum" }) => {
      try {
        const balance = await services.getERC20Balance(
          tokenAddress,
          ownerAddress,
          network
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ownerAddress,
              tokenAddress,
              network,
              balance: {
                raw: balance.raw.toString(),
                formatted: balance.formatted,
                symbol: balance.token.symbol,
                decimals: balance.token.decimals
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching ERC20 balance for ${ownerAddress}: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );



  server.tool(
    "get_address_from_private_key",
    "Get the blockchain address derived from a private key",
    {
      privateKey: z.string().optional().describe("Private key in hex format (with or without 0x prefix). If not provided, reads from WALLET_PRIVATE_KEY environment variable. SECURITY: This is used only for address derivation and is not stored.")
    },
    async ({ privateKey }) => {
      try {
        const key = privateKey || process.env.WALLET_PRIVATE_KEY;
        
        if (!key) {
          throw new Error("Private key not provided and WALLET_PRIVATE_KEY environment variable not set");
        }
        const formattedKey = key.startsWith('0x') ? key as Hex : `0x${key}` as Hex;
        const address = services.getAddressFromPrivateKey(formattedKey);
        return {
          content: [{
            type: "text",
            text: services.helpers.formatJson({
              address,
              privateKey: "0x" + key.replace(/^0x/, '')
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error deriving address from private key: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
} 