# TrendPup Frontend

Advanced Memecoin Intelligence System for Ethereum blockchain with Cortensor AI integration and comprehensive wallet support.

## Features

- Real-time chat with Cortensor AI assistant
- Ethereum memecoin tracking and analysis
- Wallet connectivity for Ethereum Sepolia testnet
- Premium access model with payment integration
- Memecoin explorer and analytics powered by Cortensor AI
- Responsive UI using Tailwind CSS
- Dashboard with multiple windows interface
- Voice interaction capabilities

## Supported Networks

TrendPup focuses on Ethereum blockchain with premium wallet connectivity:

**Ethereum Sepolia Testnet:**
- Chain ID: 11155111
- RPC: Sepolia Testnet
- Block Explorer: https://sepolia.etherscan.io/
- Currency: ETH
- Access: Premium (0.01 ETH one-time payment)

## Wallet Integration

### Supported Wallets
- MetaMask
- WalletConnect compatible wallets
- Any EVM-compatible wallet supporting Ethereum

### Premium Access
Users must:
1. Connect their Ethereum wallet
2. Switch to Sepolia testnet if needed
3. Pay 0.01 ETH one-time fee for premium access
4. Enjoy full access to Cortensor AI-powered memecoin analysis

## Cortensor AI Integration

The memecoin data and analysis is powered by Cortensor AI technologies:
- Advanced AI analysis for token recommendations
- Risk assessment using Cortensor algorithms
- Natural language processing for chat interactions
- Voice synthesis and recognition capabilities

## Getting Started

## Installation & Development

1. Install dependencies:

```bash
npm install
```

2. Build the application:

```bash
npm run build
```

3. Start the production server:

```bash
npm start
```

Or run in development mode:

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

## Wallet Integration

The frontend uses wagmi and RainbowKit for Ethereum wallet connectivity, supporting:
- MetaMask
- WalletConnect
- Rainbow Wallet
- Coinbase Wallet
- Trust Wallet
- And other popular Ethereum wallets

Make sure your wallet is configured for Ethereum Sepolia testnet.

## Configuration

- `next.config.cjs`: Next.js configuration
- `tailwind.config.js`: Tailwind CSS configuration with TrendPup theme
- `postcss.config.js`: PostCSS configuration
- `src/wagmi.ts`: Wagmi configuration for Ethereum Sepolia testnet
- `src/config/contract.ts`: Smart contract configuration for premium access

## Running the Server

TrendPup uses Next.js with nginx for HTTPS and WebSocket proxying:

1. **Start the Next.js server:**
   ```bash
   # Build and start the server
   pnpm run build
   pnpm start
   ```
   This will start Next.js on port 3000.

2. **Access the app:**
   The application is available at https://trendpup.duckdns.org

## Architecture

The frontend architecture leverages Cortensor AI technologies:
- **Cortensor AI Engine**: Powers the memecoin analysis and recommendations
- **Smart Contract Integration**: Premium access payment system on Ethereum
- **Real-time Data**: Live memecoin tracking with AI-powered insights
- **Voice Interaction**: Natural language processing for voice commands

## Nginx Configuration

The application runs behind nginx which:
- Handles HTTPS/SSL encryption
- Proxies HTTP requests to the Next.js server on port 3000
- Proxies WebSocket connections at `/ws` to the Cortensor AI backend server on port 8080

```nginx
# Main configuration at /etc/nginx/sites-enabled/trendpup.conf
server {
    listen 443 ssl;
    server_name trendpup.duckdns.org;

    # Frontend proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # Cortensor AI WebSocket proxy
    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
