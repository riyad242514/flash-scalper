# Paradex Integration Quick Start

## Prerequisites

1. **Node.js** >= 18.0.0
2. **Ethereum Private Key** (for testnet testing)
3. **Test USDC** on Paradex testnet (for trading)

---

## Setup Instructions

### Step 1: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your Paradex configuration:

```bash
# Enable Paradex
PARADEX_ENABLED=true

# Use testnet for testing
PARADEX_ENVIRONMENT=testnet

# Your Ethereum private key (will be used to derive Starknet account)
PARADEX_PRIVATE_KEY=0x... # Replace with your private key

# Testnet API URLs (already set correctly)
PARADEX_API_BASE_URL=https://api.testnet.paradex.trade
PARADEX_WS_BASE_URL=wss://ws.api.testnet.paradex.trade
```

**⚠️ IMPORTANT**: 
- Use a **testnet private key** (not your production wallet!)
- Never commit `.env` to version control
- Keep your private keys secure

---

### Step 2: Install Dependencies

```bash
npm install
```

This will install:
- `@paradex/sdk` - Paradex TypeScript SDK
- `starknet` - Starknet.js library
- Other required dependencies

---

### Step 3: Build the Project

```bash
npm run build
```

---

### Step 4: Test Connection

Run the connection test script:

```bash
node dist/scripts/test-paradex-connection.js
```

Expected output:

```
🚀 Testing Paradex Connection...

📦 Creating Paradex client...
🔑 Initializing client (deriving Starknet account)...
✅ Client initialized successfully

📍 Paradex Account Address: 0x...

📊 Loading markets...
✅ Loaded 250+ markets

🎯 Sample Perpetual Markets:
  - BTC-USD-PERP: BTC/USD
  - ETH-USD-PERP: ETH/USD
  - SOL-USD-PERP: SOL/USD
  - DOGE-USD-PERP: DOGE/USD
  - AVAX-USD-PERP: AVAX/USD

📈 Testing market data for BTC-USD-PERP...
✅ Current price: $96,450.50
   Min order size: 0.001 BTC
   Price tick: $0.1
   Min notional: $100

💰 Testing account balance...
✅ Account equity: $1,000.00
   Unrealized P&L: $0.00

📊 Testing positions...
✅ Open positions: 0

✅ All tests completed successfully!
```

---

### Step 5: Get Test USDC

To trade on Paradex testnet, you need test USDC:

1. **Visit Paradex Testnet**: https://app.testnet.paradex.trade
2. **Connect your wallet** (use the same Ethereum address as your private key)
3. **Request test USDC** from the faucet
4. **Deposit USDC** to your Paradex account

Your Paradex account is automatically deployed when you first deposit.

---

## Usage Examples

### Example 1: Check Markets

```typescript
import { ParadexClient } from './src/services/execution/paradex-client';

const client = new ParadexClient();
await client.initialize();

// Get all markets
const markets = await client.getMarkets();
console.log(`Available markets: ${markets.length}`);

// Get specific market
const btcMarket = await client.getMarketInfo('BTC-USD-PERP');
console.log('BTC Market:', btcMarket);

// Get current price
const price = await client.getPrice('BTC-USD-PERP');
console.log('BTC Price:', price);
```

### Example 2: Check Balance

```typescript
import { ParadexClient } from './src/services/execution/paradex-client';

const client = new ParadexClient();
await client.initialize();

const balance = await client.getBalance();
console.log(`Equity: $${balance.balance}`);
console.log(`Unrealized P&L: $${balance.unrealizedPnL}`);
```

### Example 3: Place Market Order

```typescript
import { ParadexClient } from './src/services/execution/paradex-client';

const client = new ParadexClient();
await client.initialize();

// Buy 0.001 BTC at market price
const result = await client.placeMarketOrder(
  'BTC-USD-PERP',
  'BUY',
  0.001,
  false // reduceOnly
);

if (result.success) {
  console.log('Order placed!');
  console.log('Order ID:', result.orderId);
  console.log('Fill Price:', result.filledPrice);
} else {
  console.error('Order failed:', result.error);
}
```

### Example 4: Monitor Positions

```typescript
import { ParadexClient } from './src/services/execution/paradex-client';

const client = new ParadexClient();
await client.initialize();

// Get all positions
const positions = await client.getPositions();
console.log(`Open positions: ${positions.length}`);

positions.forEach(pos => {
  console.log(`${pos.market}: ${pos.side} ${pos.size}`);
  console.log(`Entry: $${pos.entry_price}`);
  console.log(`Mark: $${pos.mark_price}`);
  console.log(`P&L: $${pos.unrealized_pnl}`);
});
```

### Example 5: Place Limit Order

```typescript
import { ParadexClient } from './src/services/execution/paradex-client';

const client = new ParadexClient();
await client.initialize();

// Buy 0.001 BTC at $95,000
const result = await client.placeLimitOrder(
  'BTC-USD-PERP',
  'BUY',
  0.001,
  95000,
  false
);

if (result.success) {
  console.log('Limit order placed!');
  console.log('Order ID:', result.orderId);
}
```

---

## Integration with FlashScalper

The Paradex client is now integrated into FlashScalper. You can use it alongside the existing Aster client.

### Run FlashScalper with Paradex

```bash
# Enable Paradex in .env
PARADEX_ENABLED=true
PARADEX_ENVIRONMENT=testnet

# Run the scalper
npm run start:scalper
```

The scalper will now use Paradex for trading if enabled.

---

## Switching to Production

When you're ready to trade on mainnet:

1. **Update `.env`**:

```bash
# Switch to production
PARADEX_ENVIRONMENT=prod

# Update API URLs
PARADEX_API_BASE_URL=https://api.paradex.trade
PARADEX_WS_BASE_URL=wss://ws.api.paradex.trade

# Use PRODUCTION private key (with real funds!)
PARADEX_PRIVATE_KEY=0x... # Your production key
```

2. **Deposit Real USDC**:
   - Visit https://app.paradex.trade
   - Deposit USDC from Ethereum mainnet
   - Account will be deployed automatically

3. **Start Small**:
   - Test with minimum position sizes
   - Monitor closely for first few trades
   - Gradually increase position sizes

4. **Monitor**:
   - Check logs: `tail -f logs/execution.log`
   - Check metrics: `http://localhost:9090/metrics`
   - Check positions: https://app.paradex.trade

---

## Troubleshooting

### "Client not initialized"

**Solution**: Call `await client.initialize()` before using any methods.

```typescript
const client = new ParadexClient();
await client.initialize(); // ← Required!
await client.getBalance();
```

### "Invalid private key"

**Solution**: Ensure private key is in correct format:
- Must start with `0x`
- Must be 64 hex characters (66 with `0x` prefix)
- Example: `0x1234567890abcdef...` (64 chars)

### "Account not found"

**Solution**: Your account hasn't been deployed yet. Deposit USDC to deploy it:
1. Visit https://app.testnet.paradex.trade
2. Connect wallet
3. Deposit test USDC
4. Wait for deployment (automatic)

### "Insufficient balance"

**Solution**: Deposit more USDC:
- Testnet: Get from faucet at https://app.testnet.paradex.trade
- Mainnet: Bridge USDC from Ethereum

### "Market not found"

**Solution**: Check market symbol format:
- Correct: `BTC-USD-PERP`
- Incorrect: `BTCUSDT` or `BTC-USDT-PERP`

### "Order size too small"

**Solution**: Check minimum order size:

```typescript
const market = await client.getMarketInfo('BTC-USD-PERP');
console.log('Min size:', market.order_size_increment);
console.log('Min notional:', market.min_notional);
```

### "Price precision error"

**Solution**: Use `formatPrice()` and `formatQuantity()`:

```typescript
const size = client.formatQuantity('BTC-USD-PERP', 0.0015);
const price = client.formatPrice('BTC-USD-PERP', 96543.789);
```

---

## Additional Resources

### Documentation

- [Paradex Docs](https://docs.paradex.trade) - Official documentation
- [Paradex SDK](https://github.com/tradeparadex/paradex.js) - TypeScript SDK
- [Starknet Docs](https://docs.starknet.io) - Starknet documentation

### Community

- [Discord](https://discord.gg/paradex) - $DIME Nation
- [Twitter](https://twitter.com/tradeparadex) - Latest updates

### Trading

- [Paradex Testnet](https://app.testnet.paradex.trade) - Test trading
- [Paradex Mainnet](https://app.paradex.trade) - Live trading
- [Block Explorer](https://voyager.testnet.paradex.trade) - Testnet transactions

---

## Next Steps

1. ✅ Set up Paradex configuration
2. ✅ Test connection
3. ✅ Get test USDC
4. 🔄 Place test orders
5. ⏳ Monitor positions
6. ⏳ Integrate with live streams
7. ⏳ Deploy to production

---

## Support

For issues or questions:

1. Check [PARADEX_INTEGRATION_PLAN.md](./PARADEX_INTEGRATION_PLAN.md) for detailed documentation
2. Check [PARADEX_AUTHENTICATION.md](./PARADEX_AUTHENTICATION.md) for auth issues
3. Visit [Paradex Discord](https://discord.gg/paradex) for community support
4. Open a GitHub issue for bugs

---

*Last Updated: December 23, 2025*
