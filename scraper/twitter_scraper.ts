// STEALTH: Use playwright-extra and stealth plugin
const {chromium} = require('playwright');
import * as fs from 'fs';
import https from 'https';

// Types and interfaces
interface Token {
  name: string;
  symbol: string;
  price?: string;
  volume?: string;
  liquidity?: string;
  mcap?: string;
  transactions?: string;
  age?: string;
  [key: string]: any;
}

interface TweetData {
  id: string;
  text: string;
  author: {
    name: string;
    handle: string;
  };
  timestamp: string;
  engagement: {
    likes: string;
    retweets: string;
    replies: string;
  };
  collectedAt: string;
}

interface TokenResult {
  symbol: string;
  name: string;
  searchQuery: string;
  searchTimestamp: string;
  tweets: TweetData[];
  totalTweets: number;
  scrollDuration: number;
  error: string | null;
}

interface ScrapingResults {
  timestamp: string;
  totalTokens: number;
  results: TokenResult[];
}

interface ScrapingQueue {
  timestamp: string;
  activeTokens: Token[];
  maxTokens: number;
  lastFileHash: string;
  scrapedTokens: Set<string>; // Track which tokens have been scraped
}

// Configuration
const MAX_TOKENS_TO_SCRAPE = 20; // Limit concurrent scraping to 20 tokens
// Path to the rolling tweets file
const TWEETS_FILE = 'tweets.json';
const MAX_TOKENS_IN_FILE = 100;

// In-memory queue - no file needed
let currentQueue: ScrapingQueue = {
  timestamp: new Date().toISOString(),
  activeTokens: [],
  maxTokens: MAX_TOKENS_TO_SCRAPE,
  lastFileHash: '',
  scrapedTokens: new Set()
};

// Track last-scraped timestamps for each token
let lastScraped: Record<string, string> = {};

// Flag to block token file reading during a full run
let isFullRunInProgress = false;
let pendingNewTokens: Token[] = [];

// Function to get file hash for detecting changes
function getFileHash(filePath: string): string {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    // Simple hash using file content length and first/last chars
    const hash = fileContent.length.toString() + 
                 (fileContent.charCodeAt(0) || 0).toString() + 
                 (fileContent.charCodeAt(fileContent.length - 1) || 0).toString();
    return hash;
  } catch (error) {
    return '';
  }
}

function getCombinedFileHash(): string {
  const files = ['flowevm_tokens.json', 'near_tokens.json'];
  return files.map(f => getFileHash(f)).join('-');
}

// Function to get all tokens from both flowevm and near files
function getAllTokens(): Token[] {
  const files = ['flowevm_tokens.json', 'near_tokens.json'];
  let allTokens: Token[] = [];
  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        const tokensData = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(tokensData.tokens)) {
          allTokens = allTokens.concat(tokensData.tokens);
        }
      } catch (e) {
        console.error(`Error reading ${file}:`, e);
      }
    }
  }
  return allTokens;
}

// Helper to load tweets.json (rolling file)
function loadTweetsFile(): Record<string, TokenResult> {
  if (!fs.existsSync(TWEETS_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
    // Data is an array or object keyed by symbol
    if (Array.isArray(data)) {
      // Legacy: convert to object
      const obj: Record<string, TokenResult> = {};
      data.forEach((tr: TokenResult) => { obj[tr.symbol] = tr; });
      return obj;
    }
    return data;
  } catch (e) {
    console.error('Error loading tweets.json:', e);
    return {};
  }
}

// Helper to save tweets.json (rolling file)
function saveTweetsFile(tweetsObj: Record<string, TokenResult>) {
  // Only keep up to MAX_TOKENS_IN_FILE, remove oldest by searchTimestamp
  const entries = Object.entries(tweetsObj);
  if (entries.length > MAX_TOKENS_IN_FILE) {
    // Sort by searchTimestamp ascending (oldest first)
    entries.sort((a, b) => new Date(a[1].searchTimestamp).getTime() - new Date(b[1].searchTimestamp).getTime());
  }
  const trimmed = entries.slice(-MAX_TOKENS_IN_FILE);
  const outObj: Record<string, TokenResult> = {};
  trimmed.forEach(([symbol, tr]) => { outObj[symbol] = tr; });
  fs.writeFileSync(TWEETS_FILE, JSON.stringify(outObj, null, 2));
}

// Helper: Update tweets.json after each token
function updateTweetsFileWithToken(tokenResult: TokenResult, currentSymbols: Set<string>) {
  const tweetsData = loadTweetsFile();
  // Remove any tokens not in the current 100
  let filtered = Object.values(tweetsData).filter(t => currentSymbols.has(t.symbol));
  // Remove this token if already present (to update it)
  filtered = filtered.filter(t => t.symbol !== tokenResult.symbol);
  // Add the new/updated token at the end
  filtered.push(tokenResult);
  // If more than 100, remove oldest
  while (filtered.length > MAX_TOKENS_IN_FILE) filtered.shift();
  // Convert back to object for saving
  const filteredObj = {} as Record<string, TokenResult>;
  filtered.forEach(tr => { filteredObj[tr.symbol] = tr; });
  saveTweetsFile(filteredObj);
}

// Function to update scraping queue with new tokens
function updateScrapingQueue(): Token[] {
  console.log('Checking for token list updates...');

  const currentFileHash = getCombinedFileHash();

  // If file hasn't changed, return current active tokens
  if (currentQueue.lastFileHash === currentFileHash && currentQueue.activeTokens.length > 0) {
    console.log('No changes detected in token list');
    return currentQueue.activeTokens;
  }

  console.log('Token list updated or first run, updating scraping queue...');

  // Load all available tokens
  const allTokens: Token[] = getAllTokens();

  // Get currently active token symbols for comparison
  const currentActiveSymbols = new Set(currentQueue.activeTokens.map(t => t.symbol));

  // Find new tokens that aren't currently being scraped
  const newTokens = allTokens.filter(token => !currentActiveSymbols.has(token.symbol));

  // If we have new tokens and we're at capacity, remove oldest tokens
  if (newTokens.length > 0 && currentQueue.activeTokens.length >= MAX_TOKENS_TO_SCRAPE) {
    const tokensToRemove = Math.min(newTokens.length, currentQueue.activeTokens.length);
    const removedTokens = currentQueue.activeTokens.splice(0, tokensToRemove);
    console.log(`Removed ${tokensToRemove} tokens from queue:`, removedTokens.map(t => t.symbol).join(', '));

    // Remove from scraped tokens set to allow them to be added back later
    removedTokens.forEach(token => currentQueue.scrapedTokens.delete(token.symbol));
  }

  // Add new tokens to the end of the queue
  const tokensToAdd = newTokens.slice(0, MAX_TOKENS_TO_SCRAPE - currentQueue.activeTokens.length);
  currentQueue.activeTokens.push(...tokensToAdd);

  if (tokensToAdd.length > 0) {
    console.log(`Added ${tokensToAdd.length} new tokens to queue:`, tokensToAdd.map(t => t.symbol).join(', '));
  }

  // If queue is empty (first run), take the first MAX_TOKENS_TO_SCRAPE tokens
  if (currentQueue.activeTokens.length === 0) {
    currentQueue.activeTokens = allTokens.slice(0, MAX_TOKENS_TO_SCRAPE);
    console.log(`Initialized queue with ${currentQueue.activeTokens.length} tokens`);
  }

  // Update queue metadata
  currentQueue.timestamp = new Date().toISOString();
  currentQueue.lastFileHash = currentFileHash;

  console.log(`Active scraping queue: ${currentQueue.activeTokens.length} tokens`);
  return currentQueue.activeTokens;
}

const userAgentStrings = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.2227.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.3497.92 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
];

// Tor control port config for IP rotation
const net = require('net');
const TOR_CONTROL_PORT = 9051;
const TOR_CONTROL_PASSWORD = "trendpup";

async function sendTorNewnym(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(TOR_CONTROL_PORT, '127.0.0.1', () => {
      socket.write(`AUTHENTICATE \"${TOR_CONTROL_PASSWORD}\"\r\n`);
    });
    let authenticated = false;
    socket.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!authenticated && msg.indexOf('250 OK') !== -1) {
        authenticated = true;
        socket.write('SIGNAL NEWNYM\r\n');
      } else if (authenticated && msg.indexOf('250 OK') !== -1) {
        socket.end();
        resolve();
      }
    });
    socket.on('end', () => resolve());
    socket.on('error', (err: Error) => reject(err));
  });
}

// Discord webhook configuration
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1390475263346872402/GmQcXmc39FAo6MTf8Il4T6Yg4JWc4lc_K2tF8aIvITz_p6NsnTqPi13ajlY8YxK1NOh7";
const DISCORD_PING = '<@415528007248117770>';

async function sendDiscordWebhook(message: string) {
  const data = JSON.stringify({
    content: `${DISCORD_PING} ${message}`
  });
  const url = new URL(DISCORD_WEBHOOK_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  return new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Function to run the scraping process
async function runScraper() {
  console.log(`\n=== Starting scraper run at ${new Date().toISOString()} ===`);

  const maxRetries = 3;
  let attempt = 0;
  let browser;
  let context;
  let page;
  let consecutiveFailures = 0;
  let lastUserAgentIndex = -1;
  while (attempt < maxRetries) {
    try {
      // Pick a new user agent each time
      let uaIndex;
      do {
        uaIndex = Math.floor(Math.random() * userAgentStrings.length);
      } while (uaIndex === lastUserAgentIndex && userAgentStrings.length > 1);
      lastUserAgentIndex = uaIndex;
      const userAgent = userAgentStrings[uaIndex];
      browser = await chromium.launch({ headless: false, proxy: { server: 'socks5://127.0.0.1:9050' } });
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent
      });
      page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      // Load cookies for authentication if available
      if (fs.existsSync('cookies.json')) {
        const cookiesRaw = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
        const cookies = cookiesRaw.map((cookie: any) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : undefined,
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure || false,
          sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                    cookie.sameSite === 'lax' ? 'Lax' : 
                    cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
        }));
        console.log('Setting cookies:', cookies.map((c: any) => ({ name: c.name, domain: c.domain, value: c.value.slice(0, 6) + '...' })));
        await context.addCookies(cookies);
      }
      await page.goto('https://x.com/home', { timeout: 60000 });
      await page.waitForTimeout(8000);
      try {
        // More robust: wait up to 30s for search box, check for login wall, save HTML on failure
        // Try multiple selectors for the search box
        let searchBox = null;
        const searchSelectors = [
          'SearchBox_Search_Input',
          'SearchBox_Search_Input_label',
          'searchBox',
          'search',
          'SearchBox'
        ];
        
        for (const selector of searchSelectors) {
          try {
            await page.getByTestId(selector).waitFor({ timeout: 5000 });
            searchBox = page.getByTestId(selector);
            console.log(`Found search box with selector: ${selector}`);
            break;
          } catch (e) {
            console.log(`Selector ${selector} not found, trying next...`);
          }
        }
        
        // If no testId works, try other common selectors
        if (!searchBox) {
          const altSelectors = [
            'input[placeholder*="Search"]',
            'input[aria-label*="Search"]',
            'input[data-testid*="search"]',
            'input[data-testid*="Search"]',
            '[role="searchbox"]',
            '[placeholder*="Search"]'
          ];
          
          for (const selector of altSelectors) {
            try {
              await page.locator(selector).waitFor({ timeout: 5000 });
              searchBox = page.locator(selector);
              console.log(`Found search box with CSS selector: ${selector}`);
              break;
            } catch (e) {
              console.log(`CSS selector ${selector} not found, trying next...`);
            }
          }
        }
        
        if (!searchBox) {
          throw new Error('Could not find search box with any selector');
        }
        
        await searchBox.click();
        console.log('Successfully authenticated with cookies!');
        consecutiveFailures = 0; // Reset on success
        break;
      } catch (e) {
        await page.screenshot({ path: `auth_failure_${Date.now()}.png`, fullPage: true });
        const html = await page.content();
        fs.writeFileSync(`auth_failure_${Date.now()}.html`, html);
        // Optionally, check for login wall or challenge
        if (await page.locator('text=Log in to X').count() > 0) {
          console.error('Login wall detected!');
        } else if (await page.locator('text=Enter your phone number').count() > 0) {
          console.error('Phone challenge detected!');
        }
        let errMsg;
        if (e instanceof Error) {
          errMsg = `Cookie authentication failed, cookies may be expired or navigation failed. ${e.stack}`;
        } else {
          errMsg = `Cookie authentication failed, cookies may be expired or navigation failed. ${JSON.stringify(e)}`;
        }
        await sendDiscordWebhook(`Twitter scraper authentication failed! ${errMsg}`);
        throw new Error(errMsg);
      }
    } catch (error) {
      attempt++;
      consecutiveFailures++;
      let errMsg: string;
      if (error instanceof Error) {
        errMsg = error.stack || error.message;
      } else {
        errMsg = JSON.stringify(error);
      }
      console.error(`Attempt ${attempt} failed:`, errMsg);
      await sendDiscordWebhook(`Twitter scraper runScraper error (attempt ${attempt}): ${errMsg}`);
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (consecutiveFailures >= 3) {
        console.log('Too many consecutive failures. Cooling down for 5 minutes, rotating Tor IP, and changing user agent...');
        await sendTorNewnym();
        await new Promise(res => setTimeout(res, 5 * 60 * 1000));
        consecutiveFailures = 0;
        attempt = 0; // Optionally reset attempt counter for a fresh cycle
      } else if (attempt >= maxRetries) {
        return;
      } else {
        console.log('Rotating Tor IP and retrying authentication...');
        await sendTorNewnym();
        await new Promise(res => setTimeout(res, 5000));
      }
    }
  }
  // Deduplicate tokens before scraping
  const tokens = Array.from(new Map(updateScrapingQueue().map(t => [t.symbol, t])).values());
  
  console.log(`Found ${tokens.length} tokens to search for (from active scraping queue)`);
  
  const allResults: ScrapingResults = {
    timestamp: new Date().toISOString(),
    totalTokens: tokens.length,
    results: []
  };

  await scrapeTokens(tokens, page, allResults);
  
  const totalTweetsCollected = allResults.results.reduce((sum, r) => sum + r.totalTweets, 0);
  console.log(`Scraper run completed! Total tweets collected: ${totalTweetsCollected}`);
  
  if (page) await page.close().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}

// Function to calculate milliseconds until next hour
function millisecondsUntilNextHour() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return nextHour.getTime() - now.getTime();
}

// Function to display current queue status
function displayQueueStatus(): void {
  console.log('\n=== Current Scraping Queue Status ===');
  console.log(`Last updated: ${currentQueue.timestamp}`);
  console.log(`Max tokens: ${currentQueue.maxTokens}`);
  console.log(`Active tokens: ${currentQueue.activeTokens.length}`);
  
  if (currentQueue.activeTokens.length > 0) {
    console.log('\nCurrently in queue:');
    currentQueue.activeTokens.forEach((token, index) => {
      const scrapedStatus = currentQueue.scrapedTokens.has(token.symbol) ? '✓' : '○';
      console.log(`  ${index + 1}. ${token.symbol} (${token.name}) ${scrapedStatus}`);
    });
  }
  
  // Show available tokens not in queue
  try {
    const allTokens: Token[] = getAllTokens();
    const activeSymbols = new Set(currentQueue.activeTokens.map(t => t.symbol));
    const availableTokens = allTokens.filter(token => !activeSymbols.has(token.symbol));
    
    console.log(`\nTokens not in queue: ${availableTokens.length}`);
    if (availableTokens.length > 0 && availableTokens.length <= 10) {
      console.log('Next tokens that could be added:');
      availableTokens.slice(0, 5).forEach((token) => {
        console.log(`  • ${token.symbol} (${token.name})`);
      });
      if (availableTokens.length > 5) {
        console.log(`  ... and ${availableTokens.length - 5} more`);
      }
    }
  } catch (error) {
    console.log('Could not load token files for comparison');
  }
  console.log('=====================================\n');
}

// Function to manually add a token to the queue
function addTokenToQueue(symbol: string): boolean {
  try {
    const allTokens: Token[] = getAllTokens();
    const tokenToAdd = allTokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
    
    if (!tokenToAdd) {
      console.log(`Token ${symbol} not found in token files`);
      return false;
    }
    
    const isAlreadyActive = currentQueue.activeTokens.some(t => t.symbol === tokenToAdd.symbol);
    if (isAlreadyActive) {
      console.log(`Token ${symbol} is already in the active queue`);
      return false;
    }
    
    currentQueue.activeTokens.push(tokenToAdd);
    currentQueue.timestamp = new Date().toISOString();
    console.log(`Added ${tokenToAdd.symbol} (${tokenToAdd.name}) to queue`);
    return true;
  } catch (error) {
    console.error('Error adding token to queue:', error);
    return false;
  }
}

// Function to remove a token from the queue
function removeTokenFromQueue(symbol: string): boolean {
  const initialLength = currentQueue.activeTokens.length;
  currentQueue.activeTokens = currentQueue.activeTokens.filter(t => t.symbol !== symbol);
  currentQueue.scrapedTokens.delete(symbol);
  
  if (currentQueue.activeTokens.length < initialLength) {
    currentQueue.timestamp = new Date().toISOString();
    console.log(`Removed ${symbol} from queue`);
    return true;
  } else {
    console.log(`Token ${symbol} not found in queue`);
    return false;
  }
}

// Function to scrape a list of tokens
async function scrapeTokens(tokens: Token[], page: any, allResults: ScrapingResults) {
  // Load rolling tweets file at start
  let tweetsObj = loadTweetsFile();
  let failedTokens: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const symbol = token.symbol;
    const name = token.name;
    const tokenResult: TokenResult = {
      symbol: symbol,
      name: name,
      searchQuery: `$${symbol}`,
      searchTimestamp: new Date().toISOString(),
      tweets: [],
      totalTweets: 0,
      scrollDuration: 30000,
      error: null
    };
    try {
      const startTokenTime = Date.now();
      
      // Find search box with robust selector approach
      let searchBox = null;
      const searchSelectors = [
        'SearchBox_Search_Input',
        'SearchBox_Search_Input_label',
        'searchBox',
        'search',
        'SearchBox'
      ];
      
      for (const selector of searchSelectors) {
        try {
          await page.getByTestId(selector).waitFor({ timeout: 2000 });
          searchBox = page.getByTestId(selector);
          console.log(`Using search box selector: ${selector}`);
          break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If no testId works, try other common selectors
      if (!searchBox) {
        const altSelectors = [
          'input[placeholder*="Search"]',
          'input[aria-label*="Search"]',
          'input[data-testid*="search"]',
          'input[data-testid*="Search"]',
          '[role="searchbox"]',
          '[placeholder*="Search"]'
        ];
        
        for (const selector of altSelectors) {
          try {
            await page.locator(selector).waitFor({ timeout: 2000 });
            searchBox = page.locator(selector);
            console.log(`Using search box CSS selector: ${selector}`);
            break;
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      if (!searchBox) {
        throw new Error('Could not find search box for token search');
      }
      
      await searchBox.click();
      await searchBox.fill('');
      await searchBox.fill(`$${symbol}`);
      await page.keyboard.press('Enter');
      // Wait for tweets to appear after navigation
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
      try {
        await page.getByRole('tab', { name: 'Latest' }).click();
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('Latest tab not found, continuing with default results');
      }
      const scrollDuration = 30000;
      const startTime = Date.now();
      let tweetCount = 0;
      const collectedTweets = new Set();
      console.log(`Scrolling for ${symbol} for ${scrollDuration/1000}s...`);
      while (Date.now() - startTime < scrollDuration) {
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(300);
        try {
          const tweetElements = await page.locator('[data-testid="tweet"]').all();
          for (const tweet of tweetElements) {
            try {
              const tweetText = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => '');
              const authorHandle = await tweet.locator('[data-testid="User-Name"] a').textContent().catch(() => '');
              const authorName = await tweet.locator('[data-testid="User-Name"] span').first().textContent().catch(() => '');
              const timestamp = await tweet.locator('time').getAttribute('datetime').catch(() => '');
              const likes = await tweet.locator('[data-testid="like"] span').textContent().catch(() => '0');
              const retweets = await tweet.locator('[data-testid="retweet"] span').textContent().catch(() => '0');
              const replies = await tweet.locator('[data-testid="reply"] span').textContent().catch(() => '0');
              const tweetId = `${authorHandle}_${timestamp}_${tweetText.substring(0, 50)}`;
              if (tweetText && !collectedTweets.has(tweetId)) {
                collectedTweets.add(tweetId);
                const tweetData: TweetData = {
                  id: tweetId,
                  text: tweetText || '',
                  author: {
                    name: authorName || '',
                    handle: authorHandle || ''
                  },
                  timestamp: timestamp || '',
                  engagement: {
                    likes: likes || '0',
                    retweets: retweets || '0',
                    replies: replies || '0'
                  },
                  collectedAt: new Date().toISOString()
                };
                tokenResult.tweets.push(tweetData);
                tweetCount++;
              }
            } catch (tweetError) { continue; }
          }
        } catch (e) { }
        await page.waitForTimeout(Math.random() * 700 + 100);
        // Hard stop if total time for this token exceeds 40s
        if (Date.now() - startTokenTime > 40000) {
          console.log(`Hard timeout: Stopping scrape for ${symbol} after 40s.`);
          break;
        }
      }
      tokenResult.totalTweets = tokenResult.tweets.length;
      allResults.results.push(tokenResult);
      lastScraped[symbol] = new Date().toISOString();
      // --- Rolling file update logic ---
      tweetsObj[symbol] = tokenResult;
      saveTweetsFile(tweetsObj);
      // --- End rolling file update ---
    } catch (error) {
      console.error(`Error searching for ${symbol}:`, (error as any).message);
      tokenResult.error = (error as any).message;
      tokenResult.totalTweets = 0;
      allResults.results.push(tokenResult);
      // Still update rolling file with error result
      tweetsObj[symbol] = tokenResult;
      saveTweetsFile(tweetsObj);
      failedTokens.push(token); // Add to retry list
      continue;
    }
  }
  // Retry failed tokens after 1 minute, only once
  if (failedTokens.length > 0) {
    console.log(`Retrying ${failedTokens.length} failed token(s) after 1 minute...`);
    await new Promise(res => setTimeout(res, 60000));
    // Remove duplicates in case of repeated failures
    const uniqueFailed = Array.from(new Map(failedTokens.map(t => [t.symbol, t])).values());
    // Use the same page instance for retry
    for (let i = 0; i < uniqueFailed.length; i++) {
      const token = uniqueFailed[i];
      const symbol = token.symbol;
      const name = token.name;
      const tokenResult: TokenResult = {
        symbol: symbol,
        name: name,
        searchQuery: `$${symbol}`,
        searchTimestamp: new Date().toISOString(),
        tweets: [],
        totalTweets: 0,
        scrollDuration: 30000,
        error: null
      };
      try {
        const startTokenTime = Date.now();
        
        // Find search box with robust selector approach
        let searchBox = null;
        const searchSelectors = [
          'SearchBox_Search_Input',
          'SearchBox_Search_Input_label',
          'searchBox',
          'search',
          'SearchBox'
        ];
        
        for (const selector of searchSelectors) {
          try {
            await page.getByTestId(selector).waitFor({ timeout: 2000 });
            searchBox = page.getByTestId(selector);
            console.log(`Using search box selector: ${selector}`);
            break;
          } catch (e) {
            // Continue to next selector
          }
        }
        
        // If no testId works, try other common selectors
        if (!searchBox) {
          const altSelectors = [
            'input[placeholder*="Search"]',
            'input[aria-label*="Search"]',
            'input[data-testid*="search"]',
            'input[data-testid*="Search"]',
            '[role="searchbox"]',
            '[placeholder*="Search"]'
          ];
          
          for (const selector of altSelectors) {
            try {
              await page.locator(selector).waitFor({ timeout: 2000 });
              searchBox = page.locator(selector);
              console.log(`Using search box CSS selector: ${selector}`);
              break;
            } catch (e) {
              // Continue to next selector
            }
          }
        }
        
        if (!searchBox) {
          throw new Error('Could not find search box for token search');
        }
        
        await searchBox.click();
        await searchBox.fill('');
        await searchBox.fill(`$${symbol}`);
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
        try {
          await page.getByRole('tab', { name: 'Latest' }).click();
          await page.waitForTimeout(1000);
        } catch (e) {
          console.log('Latest tab not found, continuing with default results');
        }
        const scrollDuration = 30000;
        const startTime = Date.now();
        let tweetCount = 0;
        const collectedTweets = new Set();
        console.log(`[RETRY] Scrolling for ${symbol} for ${scrollDuration/1000}s...`);
        while (Date.now() - startTime < scrollDuration) {
          await page.keyboard.press('PageDown');
          await page.waitForTimeout(300);
          try {
            const tweetElements = await page.locator('[data-testid="tweet"]').all();
            for (const tweet of tweetElements) {
              try {
                const tweetText = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => '');
                const authorHandle = await tweet.locator('[data-testid="User-Name"] a').textContent().catch(() => '');
                const authorName = await tweet.locator('[data-testid="User-Name"] span').first().textContent().catch(() => '');
                const timestamp = await tweet.locator('time').getAttribute('datetime').catch(() => '');
                const likes = await tweet.locator('[data-testid="like"] span').textContent().catch(() => '0');
                const retweets = await tweet.locator('[data-testid="retweet"] span').textContent().catch(() => '0');
                const replies = await tweet.locator('[data-testid="reply"] span').textContent().catch(() => '0');
                const tweetId = `${authorHandle}_${timestamp}_${tweetText.substring(0, 50)}`;
                if (tweetText && !collectedTweets.has(tweetId)) {
                  collectedTweets.add(tweetId);
                  const tweetData: TweetData = {
                    id: tweetId,
                    text: tweetText || '',
                    author: {
                      name: authorName || '',
                      handle: authorHandle || ''
                    },
                    timestamp: timestamp || '',
                    engagement: {
                      likes: likes || '0',
                      retweets: retweets || '0',
                      replies: replies || '0'
                    },
                    collectedAt: new Date().toISOString()
                  };
                  tokenResult.tweets.push(tweetData);
                  tweetCount++;
                }
              } catch (tweetError) { continue; }
            }
          } catch (e) { }
          await page.waitForTimeout(Math.random() * 700 + 100);
          if (Date.now() - startTokenTime > 40000) {
            console.log(`[RETRY] Hard timeout: Stopping scrape for ${symbol} after 40s.`);
            break;
          }
        }
        tokenResult.totalTweets = tokenResult.tweets.length;
        allResults.results.push(tokenResult);
        lastScraped[symbol] = new Date().toISOString();
        tweetsObj[symbol] = tokenResult;
        saveTweetsFile(tweetsObj);
      } catch (error) {
        console.error(`[RETRY] Error searching for ${symbol}:`, (error as any).message);
        tokenResult.error = (error as any).message;
        tokenResult.totalTweets = 0;
        allResults.results.push(tokenResult);
        tweetsObj[symbol] = tokenResult;
        saveTweetsFile(tweetsObj);
        continue;
      }
    }
  }
}

// Function to scrape only new tokens
async function scrapeNewTokens(newTokens: Token[]) {
  // Deduplicate new tokens
  newTokens = Array.from(new Map(newTokens.map(t => [t.symbol, t])).values());
  if (newTokens.length === 0) return;
  console.log(`\nScraping ${newTokens.length} new token(s) immediately: ${newTokens.map(t => t.symbol).join(', ')}`);
  const maxRetries = 3;
  let attempt = 0;
  let browser;
  let context;
  let page;
  while (attempt < maxRetries) {
    try {
      browser = await chromium.launch({ headless: true, proxy: { server: 'socks5://127.0.0.1:9050' } });
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
      });
      page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      // Load cookies for authentication if available
      if (fs.existsSync('cookies.json')) {
        const cookiesRaw = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
        const cookies = cookiesRaw.map((cookie: any) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : undefined,
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure || false,
          sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                    cookie.sameSite === 'lax' ? 'Lax' : 
                    cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
        }));
        await context.addCookies(cookies);
      }
      await page.goto('https://x.com/home', { timeout: 60000 });
      await page.waitForTimeout(8000);
      try {
        // More robust: wait up to 30s for search box, check for login wall, save HTML on failure
        // Try multiple selectors for the search box
        let searchBox = null;
        const searchSelectors = [
          'SearchBox_Search_Input',
          'SearchBox_Search_Input_label',
          'searchBox',
          'search',
          'SearchBox'
        ];
        
        for (const selector of searchSelectors) {
          try {
            await page.getByTestId(selector).waitFor({ timeout: 5000 });
            searchBox = page.getByTestId(selector);
            console.log(`Found search box with selector: ${selector}`);
            break;
          } catch (e) {
            console.log(`Selector ${selector} not found, trying next...`);
          }
        }
        
        // If no testId works, try other common selectors
        if (!searchBox) {
          const altSelectors = [
            'input[placeholder*="Search"]',
            'input[aria-label*="Search"]',
            'input[data-testid*="search"]',
            'input[data-testid*="Search"]',
            '[role="searchbox"]',
            '[placeholder*="Search"]'
          ];
          
          for (const selector of altSelectors) {
            try {
              await page.locator(selector).waitFor({ timeout: 5000 });
              searchBox = page.locator(selector);
              console.log(`Found search box with CSS selector: ${selector}`);
              break;
            } catch (e) {
              console.log(`CSS selector ${selector} not found, trying next...`);
            }
          }
        }
        
        if (!searchBox) {
          throw new Error('Could not find search box with any selector');
        }
        
        await searchBox.click();
        console.log('Successfully authenticated with cookies!');
        break;
      } catch (e) {
        await page.screenshot({ path: `auth_failure_${Date.now()}.png`, fullPage: true });
        const html = await page.content();
        fs.writeFileSync(`auth_failure_${Date.now()}.html`, html);
        // Optionally, check for login wall or challenge
        if (await page.locator('text=Log in to X').count() > 0) {
          console.error('Login wall detected!');
        } else if (await page.locator('text=Enter your phone number').count() > 0) {
          console.error('Phone challenge detected!');
        }
        let errMsg: string;
        if (e instanceof Error) {
          errMsg = `Cookie authentication failed, cookies may be expired or navigation failed. ${e.stack}`;
        } else {
          errMsg = `Cookie authentication failed, cookies may be expired or navigation failed. ${JSON.stringify(e)}`;
        }
        await sendDiscordWebhook(`Twitter scraper authentication failed! ${errMsg}`);
        throw new Error(errMsg);
      }
    } catch (error) {
      attempt++;
      let errMsg: string;
      if (error instanceof Error) {
        errMsg = error.stack || error.message;
      } else {
        errMsg = JSON.stringify(error);
      }
      console.error(`Attempt ${attempt} failed:`, errMsg);
      await sendDiscordWebhook(`Twitter scraper scrapeNewTokens error (attempt ${attempt}): ${errMsg}`);
      if (attempt >= maxRetries) {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
        return;
      }
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      console.log('Rotating Tor IP and retrying authentication...');
      await sendTorNewnym();
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  try {
    const allResults: ScrapingResults = {
      timestamp: new Date().toISOString(),
      totalTokens: newTokens.length,
      results: []
    };
    await scrapeTokens(newTokens, page, allResults);
    const totalTweetsCollected = allResults.results.reduce((sum, r) => sum + r.totalTweets, 0);
    console.log(`New token scrape completed! Total tweets collected: ${totalTweetsCollected}`);
  } catch (error) {
    let errMsg: string;
    if (error instanceof Error) {
      errMsg = error.stack || error.message;
    } else {
      errMsg = JSON.stringify(error);
    }
    console.error('Error during new token scraping:', errMsg);
    await sendDiscordWebhook(`Twitter scraper scrapeTokens error: ${errMsg}`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Main execution function
(async () => {
  console.log('Twitter Token Scraper - Dynamic Token Mode (100 tokens)');
  console.log('==========================================');

  // Initial scrape of all tokens
  async function scrapeAllTokens() {
    isFullRunInProgress = true;
    const tokens = getAllTokens();
    const browser = await chromium.launch({ headless: true });
    try {
      const cookiesRaw = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
      const cookies = cookiesRaw.map((cookie: any) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : undefined,
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                  cookie.sameSite === 'lax' ? 'Lax' : 
                  cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
      }));
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
      });
      await context.addCookies(cookies);
      const page = await context.newPage();
      await page.goto('https://x.com/home');
      try {
        // Find search box with robust selector approach
        let searchBox = null;
        const searchSelectors = [
          'SearchBox_Search_Input',
          'SearchBox_Search_Input_label',
          'searchBox',
          'search',
          'SearchBox'
        ];
        
        for (const selector of searchSelectors) {
          try {
            await page.getByTestId(selector).waitFor({ timeout: 2000 });
            searchBox = page.getByTestId(selector);
            console.log(`Using search box selector: ${selector}`);
            break;
          } catch (e) {
            // Continue to next selector
          }
        }
        
        // If no testId works, try other common selectors
        if (!searchBox) {
          const altSelectors = [
            'input[placeholder*="Search"]',
            'input[aria-label*="Search"]',
            'input[data-testid*="search"]',
            'input[data-testid*="Search"]',
            '[role="searchbox"]',
            '[placeholder*="Search"]'
          ];
          
          for (const selector of altSelectors) {
            try {
              await page.locator(selector).waitFor({ timeout: 2000 });
              searchBox = page.locator(selector);
              console.log(`Using search box CSS selector: ${selector}`);
              break;
            } catch (e) {
              // Continue to next selector
            }
          }
        }
        
        if (!searchBox) {
          throw new Error('Could not find search box for authentication check');
        }
        
        await searchBox.click({ timeout: 10000 });
        console.log('Successfully authenticated with cookies!');
      } catch (e) {
        console.log('Cookie authentication failed, cookies may be expired');
        await browser.close();
        isFullRunInProgress = false;
        return;
      }
      const allResults: ScrapingResults = {
        timestamp: new Date().toISOString(),
        totalTokens: tokens.length,
        results: []
      };
      await scrapeTokens(tokens, page, allResults);
      const totalTweetsCollected = allResults.results.reduce((sum, r) => sum + r.totalTweets, 0);
      console.log(`Scraper run completed! Total tweets collected: ${totalTweetsCollected}`);
      await context.close();
    } catch (error) {
      console.error('Error during scraping:', error);
    } finally {
      await browser.close();
      isFullRunInProgress = false;
      // If any new tokens were detected during the full run, scrape them now
      if (pendingNewTokens.length > 0) {
        const unique = Array.from(new Set(pendingNewTokens.map(t => t.symbol)));
        const allTokens = getAllTokens();
        const toScrape = allTokens.filter(t => unique.includes(t.symbol));
        console.log(`\nScraping ${toScrape.length} new token(s) detected during full run: ${toScrape.map(t => t.symbol).join(', ')}`);
        await scrapeNewTokens(toScrape);
        pendingNewTokens = [];
      }
    }
  }

  // Initial full scrape
  await scrapeAllTokens();

  // Watch for new tokens
  let lastTokenSymbols = new Set(getAllTokens().map(t => t.symbol));
  ['flowevm_tokens.json', 'near_tokens.json'].forEach(tokenFile => {
    if (fs.existsSync(tokenFile)) {
      fs.watchFile(tokenFile, { interval: 5000 }, async (curr, prev) => {
        const tokens = getAllTokens();
        const currentSymbols = new Set(tokens.map(t => t.symbol));
        const newTokens = tokens.filter(t => !lastTokenSymbols.has(t.symbol));
        if (newTokens.length > 0) {
          if (isFullRunInProgress) {
            // Queue new tokens to be scraped after the full run
            pendingNewTokens.push(...newTokens);
          } else {
            await scrapeNewTokens(newTokens);
            // Update lastScraped for new tokens
            newTokens.forEach(t => lastScraped[t.symbol] = new Date().toISOString());
          }
        }
        lastTokenSymbols = currentSymbols;
      });
    }
  });

  // Schedule to run every 12 hours
  function msUntilNext12Hour() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(Math.ceil(now.getHours() / 12) * 12, 0, 0, 0);
    if (next <= now) next.setHours(next.getHours() + 12);
    return next.getTime() - now.getTime();
  }
  console.log(`\nScheduling next full scrape in ${Math.round(msUntilNext12Hour() / 1000 / 60)} minutes...`);
  setTimeout(() => {
    scrapeAllTokens();
    setInterval(scrapeAllTokens, 12 * 60 * 60 * 1000);
  }, msUntilNext12Hour());

  console.log('Scraper is running in dynamic token mode. Press Ctrl+C to stop.');
})();
