import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { randomBytes } from 'crypto';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const TWEETS_FILE = 'tweets.json';
export const OUTPUT_FILE = 'ai_analyzer.json';
export const ETHEREUM_TOKENS = 'ethereum_tokens.json';

// Cortensor API Configuration
// Uses LLaMA 3.1 8B Q4 model running on local Cortensor router node
const CORTENSOR_BASE_URL = process.env.CORTENSOR_BASE_URL || 'http://127.0.0.1:5010';
const CORTENSOR_API_KEY = process.env.CORTENSOR_API_KEY || 'default-dev-token';
const USE_SSE = process.env.CORTENSOR_USE_SSE === 'true' || false;

// Generate unique session ID
function generateSessionId(): string {
  return randomBytes(4).toString('hex'); // 8-character hex string
}

// Cortensor API client
const cortensorClient = axios.create({
  baseURL: CORTENSOR_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(CORTENSOR_API_KEY && { 'Authorization': `Bearer ${CORTENSOR_API_KEY}` })
  },
  timeout: 120000
});

// SSE Event Parser
function parseSSEEvent(chunk: string): { data?: string, event?: string, id?: string } | null {
  const lines = chunk.split('\n');
  const event: { data?: string, event?: string, id?: string } = {};
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      event.data = line.slice(6);
    } else if (line.startsWith('event: ')) {
      event.event = line.slice(7);
    } else if (line.startsWith('id: ')) {
      event.id = line.slice(4);
    }
  }
  
  return Object.keys(event).length > 0 ? event : null;
}

// Cortensor API Functions
/**
 * Get completion from Cortensor API using LLaMA 3.1 8B Q4 model
 * @param prompt - The prompt to send to the model
 * @param useStream - Whether to use Server-Sent Events streaming
 * @returns Promise<string> - The model's response
 */
async function cortensorCompletion(prompt: string, useStream: boolean = false): Promise<string> {
  try {
    if (useStream && USE_SSE) {
      return await cortensorCompletionSSE(prompt);
    } else {
      return await cortensorCompletionStandard(prompt);
    }
  } catch (error) {
    console.error('Cortensor API error:', error);
    throw error;
  }
}

async function cortensorCompletionStandard(prompt: string): Promise<string> {
  const sessionId = generateSessionId();
  const response = await cortensorClient.post(`/api/v1/completions/${sessionId}`, {
    prompt: prompt,
    stream: false,
    timeout: 60
  });
  
  return response.data?.response || response.data?.choices?.[0]?.text || response.data?.text || '';
}

async function cortensorCompletionSSE(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sessionId = generateSessionId();
    const timeout = setTimeout(() => {
      reject(new Error('SSE stream timeout'));
    }, 120000);

    let fullResponse = '';
    let buffer = '';

    const request = axios({
      method: 'POST',
      url: `${CORTENSOR_BASE_URL}/api/v1/completions/${sessionId}`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...(CORTENSOR_API_KEY && { 'Authorization': `Bearer ${CORTENSOR_API_KEY}` })
      },
      data: {
        prompt: prompt,
        stream: true,
        max_tokens: 2000,
        temperature: 0.2
      },
      responseType: 'stream'
    });

    request.then(response => {
      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = parseSSEEvent(line);
            if (event?.data) {
              try {
                if (event.data === '[DONE]') {
                  clearTimeout(timeout);
                  resolve(fullResponse);
                  return;
                }
                
                const parsedData = JSON.parse(event.data);
                if (parsedData.choices?.[0]?.delta?.content) {
                  fullResponse += parsedData.choices[0].delta.content;
                } else if (parsedData.response) {
                  fullResponse += parsedData.response;
                } else if (parsedData.text) {
                  fullResponse += parsedData.text;
                }
              } catch (parseError) {
                // Handle non-JSON data
                if (event.data !== '[DONE]') {
                  fullResponse += event.data;
                }
              }
            }
          }
        }
      });

      response.data.on('end', () => {
        clearTimeout(timeout);
        resolve(fullResponse);
      });

      response.data.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).catch(error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// Cortensor Chat Completion (Alternative API)
async function cortensorChatCompletion(messages: Array<{role: string, content: string}>): Promise<string> {
  try {
    const sessionId = generateSessionId();
    const response = await cortensorClient.post(`/api/v1/chat/completions/${sessionId}`, {
      messages: messages,
      stream: false
    });
    
    return response.data?.choices?.[0]?.message?.content || response.data?.response || '';
  } catch (error) {
    console.error('Cortensor Chat API error:', error);
    throw error;
  }
}

// Health Check
async function cortensorHealthCheck(): Promise<boolean> {
  try {
    const response = await cortensorClient.get('/health');
    return response.status === 200;
  } catch (error) {
    console.warn('Cortensor health check failed:', error);
    return false;
  }
}

let lastEthereumTokensModified = 0;
let analysisSessionId = 0;
let isAnalyzerRunning = false;

const MARKET_DATA_UPDATE_INTERVAL = 10000;
let isMarketDataSyncing = false;
let marketDataSyncInterval: NodeJS.Timeout | null = null;

const RATE_LIMIT_DELAY = 12000;
const RETRY_DELAY = 30000;
const MAX_RETRIES = 3;

interface SimplifiedTokenAnalysis {
  symbol: string;
  symbol1?: string;
  chain: string;
  risk: number;
  investmentPotential: number;
  rationale: string;
  price: number;
  volume: string;
  marketCap: string;
  change24h: number;
  age: string;
  href: string;
  imageUrl: string | null;
  lastAnalyzed: string;
  rawRiskScore?: number;
}

interface TokenWithChain {
  symbol: string;
  name: string;
  chain: string;
  [key: string]: any;
}

function loadAllTokens(): { tokens: TokenWithChain[], ethereumCount: number } {
  let allTokens: TokenWithChain[] = [];
  let ethereumCount = 0;
  
  if (fs.existsSync(ETHEREUM_TOKENS)) {
    try {
      const ethereumData = JSON.parse(fs.readFileSync(ETHEREUM_TOKENS, 'utf8'));
      const ethereumTokens = ethereumData.tokens?.map((token: any) => ({
        ...token,
        chain: 'ethereum'
      })) || [];
      allTokens = allTokens.concat(ethereumTokens);
      ethereumCount = ethereumTokens.length;
    } catch (error) {
      console.error('Error loading Ethereum tokens:', error);
    }
  }
  return { tokens: allTokens, ethereumCount };
}

async function syncMarketDataToAnalyzer(): Promise<void> {
  if (isMarketDataSyncing) {
    return;
  }
  
  isMarketDataSyncing = true;
  
  try {
    const { tokens: freshTokens } = loadAllTokens();
    if (freshTokens.length === 0) {
      return;
    }
    if (!fs.existsSync(OUTPUT_FILE)) {
      return;
    }
    
    const analysisData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    if (!analysisData.results || !Array.isArray(analysisData.results)) {
      return;
    }
    
    let updatedCount = 0;
    analysisData.results = analysisData.results.map((result: any) => {
      const freshTokenInfo = freshTokens.find((t: any) => 
        t.symbol === result.symbol && t.chain === result.chain
      );
      
      if (freshTokenInfo) {
        const parsePrice = (priceStr: string): number => {
          const cleaned = priceStr.replace(/,/g, '').replace(/[^\d.-]/g, '');
          const price = parseFloat(cleaned);
          return isNaN(price) ? 0 : price;
        };
        
        const parseChange = (changeStr: string): number => {
          if (changeStr === 'N/A' || !changeStr) return 0;
          const cleaned = changeStr.replace(/[^\d.-]/g, '');
          const change = parseFloat(cleaned);
          return isNaN(change) ? 0 : change;
        };
        
        const updatedResult = {
          ...result,
          price: freshTokenInfo.price ? parsePrice(freshTokenInfo.price) : result.price,
          volume: freshTokenInfo.volume || result.volume,
          marketCap: freshTokenInfo.mcap || result.marketCap,
          change24h: freshTokenInfo['change-24h'] ? parseChange(freshTokenInfo['change-24h']) : result.change24h,
          age: freshTokenInfo.age || result.age,
          href: freshTokenInfo.href || result.href,
          imageUrl: freshTokenInfo.imageUrl || result.imageUrl || null,
          risk: result.risk,
          potential: result.potential,
          chain: result.chain,
        };
        updatedCount++;
        return updatedResult;
      }
      return result;
    });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(analysisData, null, 2));
  } catch (error) {
    console.error('Error syncing market data:', error);
  } finally {
    isMarketDataSyncing = false;
  }
}

function startMarketDataSync(): void {
  syncMarketDataToAnalyzer();
  marketDataSyncInterval = setInterval(() => {
    syncMarketDataToAnalyzer();
  }, MARKET_DATA_UPDATE_INTERVAL);
}

function stopMarketDataSync(): void {
  if (marketDataSyncInterval) {
    clearInterval(marketDataSyncInterval);
    marketDataSyncInterval = null;
  }
}

async function rateLimitedDelay(retryCount: number = 0): Promise<void> {
  const delay = retryCount > 0 ? RETRY_DELAY * Math.pow(2, retryCount - 1) : RATE_LIMIT_DELAY;
  await new Promise(res => setTimeout(res, delay));
}

function parseNumericValue(valueStr: string): number {
  if (!valueStr || valueStr === 'N/A' || valueStr === '-') return 0;
  
  const cleaned = valueStr.toLowerCase().replace(/[,$\s]/g, '');
  let multiplier = 1;
  
  if (cleaned.includes('k')) {
    multiplier = 1000;
  } else if (cleaned.includes('m')) {
    multiplier = 1000000;
  } else if (cleaned.includes('b')) {
    multiplier = 1000000000;
  }
  
  const numStr = cleaned.replace(/[kmb]/g, '');
  const num = parseFloat(numStr);
  
  return isNaN(num) ? 0 : num * multiplier;
}

function parseAge(ageStr: string): number {
  if (!ageStr || ageStr === 'N/A') return Number.MAX_SAFE_INTEGER;
  const match = ageStr.match(/(\d+)(mo|[smhdy])/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    case 'mo': return value * 2592000;
    case 'y': return value * 31536000;
    default: return Number.MAX_SAFE_INTEGER;
  }
}

function calculateMemecoinRiskFactors(tokenInfo: any): {
  liquidityRisk: number,
  volatilityRisk: number,
  ageRisk: number,
  volumeRisk: number,
  totalRawRisk: number
} {
  const liquidity = parseNumericValue(tokenInfo.liquidity || '0');
  const volume = parseNumericValue(tokenInfo.volume || '0');
  const age = parseAge(tokenInfo.age || '1d');
  const change24h = Math.abs(parseFloat(tokenInfo['change-24h']?.replace(/[^\d.-]/g, '') || '0'));
  
  let liquidityRisk = 0;
  if (liquidity < 5000) liquidityRisk = 5;
  else if (liquidity < 20000) liquidityRisk = 4;
  else if (liquidity < 50000) liquidityRisk = 3;
  else if (liquidity < 100000) liquidityRisk = 2;
  else if (liquidity < 500000) liquidityRisk = 1;
  
  let volatilityRisk = 0;
  if (change24h > 500) volatilityRisk = 5;
  else if (change24h > 200) volatilityRisk = 4;
  else if (change24h > 100) volatilityRisk = 3;
  else if (change24h > 50) volatilityRisk = 2;
  else if (change24h > 20) volatilityRisk = 1;
  
  let ageRisk = 0;
  const ageInHours = age / 3600;
  if (ageInHours < 1) ageRisk = 5;
  else if (ageInHours < 6) ageRisk = 4;
  else if (ageInHours < 24) ageRisk = 3;
  else if (ageInHours < 168) ageRisk = 2; // 1 week
  else if (ageInHours < 720) ageRisk = 1; // 1 month
  
  let volumeRisk = 0;
  if (volume < 1000) volumeRisk = 5;
  else if (volume < 10000) volumeRisk = 4;
  else if (volume < 50000) volumeRisk = 3;
  else if (volume < 100000) volumeRisk = 2;
  else if (volume < 500000) volumeRisk = 1;
  
  const totalRawRisk = liquidityRisk + volatilityRisk + ageRisk + volumeRisk;
  
  return {
    liquidityRisk,
    volatilityRisk,
    ageRisk,
    volumeRisk,
    totalRawRisk
  };
}

/**
 * Analyze token using Cortensor LLaMA 3.1 8B Q4 model
 * @param symbol - Token symbol to analyze
 * @param tweets - Array of related tweets
 * @param tokenInfo - Token metadata and market data
 * @param retryCount - Current retry attempt
 * @returns Promise<SimplifiedTokenAnalysis | null>
 */
async function analyzeTokenSimplified(symbol: string, tweets: any[], tokenInfo: any, retryCount: number = 0): Promise<SimplifiedTokenAnalysis | null> {
  if (!tokenInfo) {
    console.log(`Token ${symbol} not found in token file. Skipping analysis.`);
    return null;
  }

  const tokenInfoStr = tokenInfo ? `Token Data: ${JSON.stringify(tokenInfo, null, 2)}\n` : '';
  const tweetsText = tweets.map(t => t.text).slice(0, 10).join(' | ');
  
  const riskFactors = calculateMemecoinRiskFactors(tokenInfo);
  
  const simplifiedPrompt = `You are a memecoin specialist. Assess risk RELATIVE to other memecoins, not traditional investments. All your responses must be valid JSON only.

MEMECOIN ANALYSIS - RELATIVE RISK ASSESSMENT

Token: ${symbol} (ETHEREUM Chain)
${tokenInfoStr}
Social Data: ${tweetsText}

CONTEXT: You are analyzing ETHEREUM MEMECOINS specifically. All memecoins are inherently risky, so assess risk RELATIVE to other memecoins.

ANALYSIS REQUIREMENTS:
1. Risk Level (1-10): Compare to OTHER MEMECOINS, not traditional investments
   - 1 = Lower risk memecoin (established, good liquidity, stable community)
   - 5 = Average memecoin risk
   - 10 = Extremely risky even for a memecoin (rug pull potential, very new, no liquidity)

2. Investment Potential (1-10): Upside potential within memecoin space
   - Consider community engagement, trend momentum, uniqueness
   - 10 = Very high viral/growth potential

RESPOND WITH VALID JSON ONLY:
{
  "symbol": "${symbol}",
  "is_memecoin": true,
  "risk": number,
  "potential": number,
  "rationale": "Brief analysis focusing on RELATIVE memecoin risk and viral potential"
}`;

  try {
    // Check health first if configured
    if (CORTENSOR_API_KEY) {
      const isHealthy = await cortensorHealthCheck();
      if (!isHealthy) {
        console.warn(`⚠️ Cortensor health check failed for ${symbol}, proceeding anyway`);
      }
    }

    // Use Cortensor completion with SSE support
    const responseText = await cortensorCompletion(simplifiedPrompt, USE_SSE);
    
    if (!responseText) {
      console.error(`❌ Empty response for ${symbol}`);
      return null;
    }
      
    let text = responseText.replace(/``````/g, '').trim();
    text = text.replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, ' ');
    
    const match = text.match(/\{[\s\S]*?\}/);
    let parsed;
    try {
      parsed = match ? JSON.parse(match[0]) : JSON.parse(text);
    } catch (e) {
      console.error(`❌ JSON parsing error for ${symbol}:`, e);
      console.error(`Response text: ${text}`);
      
      // Fallback: try chat completion format
      try {
        const chatResponse = await cortensorChatCompletion([
          {
            role: "system",
            content: "You are a memecoin specialist. Assess risk RELATIVE to other memecoins, not traditional investments. All your responses must be valid JSON only."
          },
          {
            role: "user", 
            content: simplifiedPrompt
          }
        ]);
        
        const chatText = chatResponse.replace(/``````/g, '').trim();
        const chatMatch = chatText.match(/\{[\s\S]*?\}/);
        parsed = chatMatch ? JSON.parse(chatMatch[0]) : JSON.parse(chatText);
      } catch (chatError) {
        console.error(`❌ Chat completion also failed for ${symbol}:`, chatError);
        return null;
      }
    }
    
    if (!parsed.is_memecoin) {
      console.log(`Token ${symbol} is not classified as a memecoin. Skipping.`);
      return null;
    }

    const parsePrice = (priceStr: string): number => {
      const cleaned = priceStr.replace(/,/g, '').replace(/[^\d.-]/g, '');
      const price = parseFloat(cleaned);
      return isNaN(price) ? 0 : price;
    };
    
    const parseChange = (changeStr: string): number => {
      if (changeStr === 'N/A' || !changeStr) return 0;
      const cleaned = changeStr.replace(/[^\d.-]/g, '');
      const change = parseFloat(cleaned);
      return isNaN(change) ? 0 : change;
    };

    const price = tokenInfo?.price ? parsePrice(tokenInfo.price) : 0;
    const volume = tokenInfo?.volume || 'N/A';
    const marketCap = tokenInfo?.mcap || 'N/A';
    const change24h = tokenInfo?.['change-24h'] ? parseChange(tokenInfo['change-24h']) : 0;
    const age = tokenInfo?.age || 'N/A';

    const aiRisk = Math.max(1, Math.min(10, parsed.risk || 5));
    const fundamentalRisk = Math.max(1, Math.min(10, (riskFactors.totalRawRisk / 20) * 10));
    const combinedRisk = Math.round((aiRisk * 0.6 + fundamentalRisk * 0.4) * 10) / 10;

    return {
      symbol: parsed.symbol || symbol,
      symbol1: tokenInfo?.symbol1 || '',
      chain: 'ethereum',
      risk: combinedRisk,
      investmentPotential: Math.max(1, Math.min(10, parsed.potential || 1)),
      rationale: parsed.rationale || 'Analysis completed',
      rawRiskScore: combinedRisk,
      price,
      volume,
      marketCap,
      change24h,
      age,
      href: tokenInfo?.href || '#',
      imageUrl: tokenInfo?.imageUrl || null,

      lastAnalyzed: new Date().toISOString()
    };

  } catch (e: any) {
    console.error(`Analysis error for ${symbol}:`, e);
    if (e.response?.status === 429 || e.code === 'ECONNRESET' || e.message?.includes('rate limit') || e.message?.includes('quota')) {
      if (retryCount < MAX_RETRIES) {
        await rateLimitedDelay(retryCount + 1);
        return analyzeTokenSimplified(symbol, tweets, tokenInfo, retryCount + 1);
      }
      throw new Error('RATE_LIMIT_EXCEEDED');
    }
    if (e.response?.status >= 500 || e.code === 'ECONNREFUSED' || e.message?.includes('timeout')) {
      if (retryCount < MAX_RETRIES) {
        await rateLimitedDelay(retryCount + 1);
        return analyzeTokenSimplified(symbol, tweets, tokenInfo, retryCount + 1);
      }
    }
    return null;
  }
}

function normalizeRiskScores(analyses: SimplifiedTokenAnalysis[]): SimplifiedTokenAnalysis[] {
  if (analyses.length < 2) return analyses;
  const rawRisks = analyses.map(a => a.rawRiskScore || a.risk).filter(r => r > 0);
  if (rawRisks.length === 0) return analyses;
  const minRisk = Math.min(...rawRisks);
  const maxRisk = Math.max(...rawRisks);
  
  if (maxRisk === minRisk) {
    return analyses.map((analysis, index) => ({
      ...analysis,
      risk: Math.max(1, Math.min(10, 5 + (Math.random() - 0.5) * 2))
    }));
  }

  return analyses.map(analysis => {
    const rawRisk = analysis.rawRiskScore || analysis.risk;
    let normalizedRisk = 1 + ((rawRisk - minRisk) / (maxRisk - minRisk)) * 9;
    normalizedRisk = Math.max(1, Math.min(10, normalizedRisk + (Math.random() - 0.5) * 0.5));
    
    return {
      ...analysis,
      risk: Math.round(normalizedRisk * 10) / 10
    };
  });
}

function writeSimplifiedResults(results: SimplifiedTokenAnalysis[], outputFile: string) {
  if (!results.length) {
    const output = { results: [] };
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    return;
  }
  
  const normalizedResults = normalizeRiskScores(results);
  const formattedResults = normalizedResults.map((analysis, index) => ({
    id: index + 1,
    symbol: analysis.symbol,
    symbol1: analysis.symbol1 || '',
    chain: analysis.chain,
    price: analysis.price,
    volume: analysis.volume,
    marketCap: analysis.marketCap,
    change24h: analysis.change24h,
    age: analysis.age,
    favorite: false,
    potential: analysis.investmentPotential,
    risk: analysis.risk,
    href: analysis.href,
    imageUrl: analysis.imageUrl || null
  }));
  
  formattedResults.sort((a, b) => {
    if (Math.abs(a.risk - b.risk) < 0.1) return b.potential - a.potential;
    return a.risk - b.risk;
  });
  
  const output = { results: formattedResults };
  
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

function checkTokensUpdated(): boolean {
  let updated = false;
  
  try {
    if (fs.existsSync(ETHEREUM_TOKENS)) {
      const ethereumStats = fs.statSync(ETHEREUM_TOKENS);
      const currentEthereumModified = ethereumStats.mtimeMs;
      if (currentEthereumModified > lastEthereumTokensModified) {
        lastEthereumTokensModified = currentEthereumModified;
        updated = true;
      }
    }
  } catch (e) {
    return false;
  }
  
  return updated;
}

function getTokenInfo(symbol: string, allTokens: TokenWithChain[]): TokenWithChain | null {
  return allTokens.find((t: TokenWithChain) => t.symbol === symbol) || null;
}

async function main() {
  
  isAnalyzerRunning = true;
  analysisSessionId++;
  const currentSessionId = analysisSessionId;
  startMarketDataSync();

  let tweetsObj: any = {};
  let tokenData: { tokens: TokenWithChain[], ethereumCount: number };
  
  try {
    if (!fs.existsSync(TWEETS_FILE)) {
      console.log('tweets.json not found.');
      return;
    }
    tweetsObj = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading tweets.json:', e);
    return;
  }
  
  try {
    tokenData = loadAllTokens();
  } catch (e) {
    console.error('Error reading token files:', e);
    return;
  }

  let analysisResults: SimplifiedTokenAnalysis[] = [];
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const fileContent = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      if (fileContent.results && Array.isArray(fileContent.results)) {
        analysisResults = fileContent.results.map((item: any) => ({
          symbol: item.symbol,
          symbol1: item.symbol1 || '',
          chain: item.chain || '',
          risk: item.risk,
          investmentPotential: item.potential,
          rationale: 'Existing analysis',
          rawRiskScore: item.risk,
          price: item.price,
          volume: item.volume,
          marketCap: item.marketCap,
          change24h: item.change24h,
          age: item.age,
          href: item.href,
          imageUrl: item.imageUrl || null,
          lastAnalyzed: new Date().toISOString()
        }));
      }
    }
  } catch (e) {
    console.error('Error reading existing results:', e);
    analysisResults = [];
  }

  try {
    if (fs.existsSync(ETHEREUM_TOKENS)) {
      const ethereumStats = fs.statSync(ETHEREUM_TOKENS);
      lastEthereumTokensModified = ethereumStats.mtimeMs;
    }
  } catch (e) {
    console.error('Error getting token file stats:', e);
  }

  const availableTokens = new Set(tokenData.tokens.map(t => t.symbol));
  const tokenQueue = Object.keys(tweetsObj).filter(symbol => availableTokens.has(symbol));

  for (let i = 0; i < tokenQueue.length; i++) {
    if (currentSessionId !== analysisSessionId) {
      break;
    }
    
    const currentSymbol = tokenQueue[i];
    try {
      
      const tweets = tweetsObj[currentSymbol]?.tweets || [];
      const tokenInfo = getTokenInfo(currentSymbol, tokenData.tokens);
      
      if (!tokenInfo) {
        continue;
      }
      
      const existing = analysisResults.find(a => a.symbol === currentSymbol && a.chain === tokenInfo.chain);
      if (existing && existing.lastAnalyzed) {
        const lastAnalyzed = new Date(existing.lastAnalyzed).getTime();
        const now = Date.now();
        const hoursAgo = (now - lastAnalyzed) / (1000 * 60 * 60);
      }
      
      const analysis = await analyzeTokenSimplified(currentSymbol, tweets, tokenInfo);
      
      if (analysis && analysis.rationale.trim()) {
        const existingIndex = analysisResults.findIndex(a => a.symbol === currentSymbol && a.chain === tokenInfo.chain);
        
        if (existingIndex >= 0) {
          analysisResults[existingIndex] = analysis;
        } else {
          analysisResults.push(analysis);
        }
        
        writeSimplifiedResults(analysisResults, OUTPUT_FILE);
      } else {
        console.log(`Skipped ${currentSymbol}: Invalid analysis`);
      }
      
    } catch (e: any) {
      if (e.message === 'RATE_LIMIT_EXCEEDED') {
        console.log('Rate limit exceeded. Stopping session.');
        break;
      }
    }
    
    if (i < tokenQueue.length - 1) {
      await rateLimitedDelay();
    }
  }

  const ethereumAnalyzed = analysisResults.filter(r => r.chain === 'ethereum').length;
  console.log(`Analysis completed - Ethereum tokens analyzed: ${ethereumAnalyzed}`);

  isAnalyzerRunning = false;
}

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  stopMarketDataSync();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  stopMarketDataSync();
  process.exit(0);
});

process.on('exit', () => {
  stopMarketDataSync();
});

console.log('AI Analyzer Started (using Cortensor API)');
main().catch(error => {
  console.error('Fatal error:', error);
  isAnalyzerRunning = false;
  stopMarketDataSync();
});