import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBlockchainResources } from "../core/resources.js";
import { registerBlockchainTools } from "../core/tools.js";
import { getSupportedNetworks, getCurrentNetwork } from "../core/chains.js";

async function startServer() {
  try {
    const currentNetwork = getCurrentNetwork();
    const server = new McpServer({
      name: "Ethereum-MCP-Server",
      version: "1.0.0"
    });
    registerBlockchainResources(server);
    registerBlockchainTools(server);
    console.error(`Ethereum MCP Server initialized`);
    console.error(`Current network: ${currentNetwork.name} (${currentNetwork.isTestnet ? 'testnet' : 'mainnet'})`);
    console.error(`Supported networks: ${getSupportedNetworks().join(", ")}`);
    console.error("Server is ready to handle requests");
    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}


export default startServer; 