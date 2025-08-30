import os
import asyncio
import logging
import threading
import time
import json
import uuid
import requests
from typing import Dict, Any, Optional, Iterator
from google.adk.agents import Agent as OriginalAgent
from dotenv import load_dotenv
from .prompts import return_instructions_root
from google.adk.tools import (google_search, FunctionTool, AgentTool)

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cortensor Configuration
CORTENSOR_BASE_URL = os.getenv('CORTENSOR_BASE_URL', 'http://127.0.0.1:5010')
CORTENSOR_API_KEY = os.getenv('CORTENSOR_API_KEY', 'default-dev-token')

class CortensorClient:
    def __init__(self):
        self.base_url = CORTENSOR_BASE_URL
        self.api_key = CORTENSOR_API_KEY
        self.session_id = self._generate_session_id()
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        })
    
    def _generate_session_id(self) -> str:
        """Generate a unique session ID"""
        return str(uuid.uuid4())[:8]  # Use first 8 chars of UUID for shorter session ID
    
    def health_check(self) -> bool:
        """Check if Cortensor API is healthy using documented status endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/api/v1/status", timeout=5)
            return response.status_code == 200
        except Exception:
            return False
    
    def completion(self, prompt: str, system_prompt: str = "", **kwargs) -> str:
        """Get completion from Cortensor API according to official docs"""
        try:
            # Combine system and user prompts as per Cortensor docs
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            
            # Use only documented parameters
            payload = {
                "prompt": full_prompt,
                "stream": False,
                "timeout": 60
            }
            
            response = self.session.post(
                f"{self.base_url}/api/v1/completions/{self.session_id}",
                json=payload,
                timeout=120
            )
            
            if response.status_code == 200:
                data = response.json()
                # Handle different response formats
                if 'response' in data:
                    return data['response']
                elif 'text' in data:
                    return data['text']
                elif 'choices' in data and data['choices']:
                    return data['choices'][0].get('text', '')
                else:
                    return str(data)
            else:
                logger.error(f"Cortensor API error: {response.status_code} - {response.text}")
                return ""
                
        except Exception as e:
            logger.error(f"Error calling Cortensor API: {e}")
            return ""
    
    def completion_stream(self, prompt: str, system_prompt: str = "", **kwargs):
        """Get streaming completion from Cortensor API using SSE"""
        try:
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            
            payload = {
                "prompt": full_prompt,
                "stream": True,
                "timeout": 60
            }
            
            response = self.session.post(
                f"{self.base_url}/api/v1/completions/{self.session_id}",
                json=payload,
                stream=True,
                timeout=120
            )
            
            if response.status_code == 200:
                for line in response.iter_lines():
                    if line:
                        line = line.decode('utf-8')
                        if line.startswith('data: '):
                            data_str = line[6:]  # Remove 'data: ' prefix
                            if data_str.strip() == '[DONE]':
                                break
                            try:
                                data = json.loads(data_str)
                                yield data
                            except json.JSONDecodeError:
                                continue
            else:
                logger.error(f"Cortensor streaming error: {response.status_code} - {response.text}")
                
        except Exception as e:
            logger.error(f"Error in Cortensor streaming: {e}")
            return

# Initialize Cortensor client
cortensor_client = CortensorClient()

# Patch the Google ADK Agent class to support Cortensor
class Agent(OriginalAgent):
    def __init__(self, *args, **kwargs):
        # Check if model is a cortensor model
        model = kwargs.get('model', '')
        if isinstance(model, str) and model.startswith('cortensor://'):
            # Store cortensor model info and remove from kwargs for parent
            self._cortensor_model = model
            self._use_cortensor = True
            # Pass a dummy model to parent to avoid errors
            kwargs['model'] = 'gemini-1.5-flash'  # Fallback model
        else:
            self._use_cortensor = False
            
        super().__init__(*args, **kwargs)
    
    def run(self, prompt: str, **kwargs):
        """Override run method to use Cortensor when appropriate"""
        if self._use_cortensor:
            try:
                # Build system prompt with instructions
                system_prompt = f"You are {self.name}. {self.instruction}"
                
                # Get completion from Cortensor using only supported parameters
                response = cortensor_client.completion(
                    prompt=prompt,
                    system_prompt=system_prompt
                )
                
                return response
                
            except Exception as e:
                logger.error(f"Error in Cortensor agent {self.name}: {e}")
                # Fallback to original ADK
                return super().run(prompt, **kwargs)
        else:
            # Use original ADK implementation
            return super().run(prompt, **kwargs)

# Cortensor model configuration
def get_cortensor_model(model_name: str = "llama-3.1-8b-q4") -> str:
    """Return Cortensor model configuration for ADK agents
    
    Args:
        model_name: The Cortensor model to use (default: llama-3.1-8b-q4)
    
    Returns:
        Model string in format 'cortensor://model_name'
    """
    return f"cortensor://{model_name}"


def ethereum_mcp_call(method: str, params: dict = None) -> dict:
    try:
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": 1
        }
        response = requests.post(
            "http://localhost:3002/api",
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30
        )
        if response.status_code == 200:
            result = response.json()
            if "result" in result:
                return {"success": True, "data": result["result"]}
            elif "error" in result:
                return {"success": False, "error": result["error"]}
        else:
            return {"success": False, "error": f"HTTP {response.status_code}: {response.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}



def get_eth_balance(address: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_balance",
        "arguments": {"address": address, "network": network}
    })

def get_eth_token_info(token_address: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_token_info",
        "arguments": {"tokenAddress": token_address, "network": network}
    })

def get_eth_chain_info(network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_chain_info",
        "arguments": {"network": network}
    })

def get_erc20_balance(address: str, token_address: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_erc20_balance",
        "arguments": {"tokenAddress": token_address, "ownerAddress": address, "network": network}
    })

def get_latest_block(network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_latest_block",
        "arguments": {"network": network}
    })

def get_block_by_number(block_number: int, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_block_by_number",
        "arguments": {"blockNumber": block_number, "network": network}
    })

def get_transaction(tx_hash: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_transaction",
        "arguments": {"hash": tx_hash, "network": network}
    })

def get_transaction_receipt(tx_hash: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_transaction_receipt",
        "arguments": {"hash": tx_hash, "network": network}
    })

def estimate_gas(to_address: str, data: str = "", value: str = "0", network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "estimate_gas",
        "arguments": {"to": to_address, "data": data, "value": value, "network": network}
    })

def read_contract(contract_address: str, abi: list, function_name: str, args: list = [], network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "read_contract",
        "arguments": {
            "contractAddress": contract_address,
            "abi": abi,
            "functionName": function_name,
            "args": args,
            "network": network
        }
    })

def is_contract(address: str, network: str = "ethereum") -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "is_contract",
        "arguments": {"address": address, "network": network}
    })

def get_supported_networks() -> dict:
    return ethereum_mcp_call("tools/call", {
        "name": "get_supported_networks",
        "arguments": {}
    })

def transfer_eth_tokens(to_address: str, amount: str, network: str = "ethereum") -> dict:
    if not check_extended_functions_enabled():
        return {"success": False, "error": "Extended functions not enabled. Private key required for transactions."}
    private_key = get_private_key_if_enabled()
    if not private_key:
        return {"success": False, "error": "No private key available for transaction signing."}
    return ethereum_mcp_call("tools/call", {
        "name": "transfer_native",
        "arguments": {"to": to_address, "amount": amount, "privateKey": private_key, "network": network}
    })

def transfer_erc20_tokens(to_address: str, token_address: str, amount: str, network: str = "ethereum") -> dict:
    if not check_extended_functions_enabled():
        return {"success": False, "error": "Extended functions not enabled. Private key required for transactions."}
    private_key = get_private_key_if_enabled()
    if not private_key:
        return {"success": False, "error": "No private key available for transaction signing."}
    return ethereum_mcp_call("tools/call", {
        "name": "transfer_erc20",
        "arguments": {
            "tokenAddress": token_address,
            "to": to_address,
            "amount": amount,
            "privateKey": private_key,
            "network": network
        }
    })

def approve_token_spending(spender_address: str, token_address: str, amount: str, network: str = "ethereum") -> dict:
    if not check_extended_functions_enabled():
        return {"success": False, "error": "Extended functions not enabled. Private key required for transactions."}
    private_key = get_private_key_if_enabled()
    if not private_key:
        return {"success": False, "error": "No private key available for transaction signing."}
    return ethereum_mcp_call("tools/call", {
        "name": "approve_token_spending",
        "arguments": {
            "tokenAddress": token_address,
            "spender": spender_address,
            "amount": amount,
            "privateKey": private_key,
            "network": network
        }
    })

def write_contract(contract_address: str, abi: list, function_name: str, args: list, network: str = "ethereum") -> dict:
    """Write data to a smart contract - requires extended functions to be enabled"""
    if not check_extended_functions_enabled():
        return {"success": False, "error": "Extended functions not enabled. Private key required for contract interactions."}
    private_key = get_private_key_if_enabled()
    if not private_key:
        return {"success": False, "error": "No private key available for transaction signing."}
    return ethereum_mcp_call("tools/call", {
        "name": "write_contract",
        "arguments": {
            "contractAddress": contract_address,
            "abi": abi,
            "functionName": function_name,
            "args": args,
            "privateKey": private_key,
            "network": network
        }
    })



def readme_data() -> dict:
    try:
        readme_path = os.path.join(os.path.dirname(__file__), '..', 'README.md')
        with open(readme_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return {
            "content": content,
            "character_count": len(content),
            "last_updated": os.path.getmtime(readme_path),
            "status": "success"
        }
    except Exception as e:
        return {
            "error": f"Failed to load README data: {str(e)}",
            "content": "",
            "status": "error"
        }



rag_agent = Agent(
    model=get_cortensor_model('llama-3.1-8b-q4'),
    name='README_Context',
    instruction=return_instructions_root('rag'),
    tools=[
        FunctionTool(readme_data),
    ],
)
search_agent = Agent(
    model=get_cortensor_model('llama-3.1-8b-q4'),
    name='Google_Search',
    instruction=return_instructions_root('search'),
    tools=[google_search],
)
ethereum_mcp_agent = Agent(
    model=get_cortensor_model('llama-3.1-8b-q4'),
    name='Ethereum_MCP',
    instruction=return_instructions_root('mcp'),
    tools=[
        FunctionTool(get_eth_balance),
        FunctionTool(get_eth_token_info),
        FunctionTool(get_eth_chain_info),
        FunctionTool(get_erc20_balance),
        FunctionTool(get_latest_block),
        FunctionTool(get_block_by_number),
        FunctionTool(get_transaction),
        FunctionTool(get_transaction_receipt),
        FunctionTool(estimate_gas),
        FunctionTool(read_contract),
        FunctionTool(is_contract),
        FunctionTool(get_supported_networks),
        FunctionTool(transfer_eth_tokens),
        FunctionTool(transfer_erc20_tokens),
        FunctionTool(approve_token_spending),
        FunctionTool(write_contract),
    ],
)
root_agent = Agent(
    model=get_cortensor_model('llama-3.1-8b-q4'),
    name='TrendPup',
    instruction=return_instructions_root('root'),
    tools=[
    AgentTool(agent=rag_agent), 
    AgentTool(agent=search_agent), 
    AgentTool(agent=ethereum_mcp_agent),
    ]
)


app = root_agent