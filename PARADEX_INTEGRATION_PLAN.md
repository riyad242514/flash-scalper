# Paradex Integration Plan

## Overview

This document outlines the plan for integrating Paradex trading support into FlashScalper for live stream trading.

**Goal**: Enable FlashScalper to trade perpetuals on Paradex, a zero-fee decentralized perpetuals exchange built on Starknet.

---

## 1. Paradex Platform Overview

### What is Paradex?

- **Decentralized perpetuals exchange** built on Starknet Layer 2
- **Zero trading fees** with institutional-grade privacy
- **250+ markets** available for trading
- **Better-than-CEX liquidity** with fast settlement
- **Cross-margin trading** for capital efficiency

### Key Features

- **Perpetual Futures**: Trade BTC-USD-PERP, ETH-USD-PERP, SOL-USD-PERP, etc.
- **Perp Options**: Trade perpetual options (e.g., BTC-USD-95000-P)
- **Zero Fees**: No trading fees (only network fees for deposits/withdrawals)
- **Privacy**: Private trading with no front-running
- **Fast Settlement**: Built on Starknet for fast finality

---

## 2. Architecture Overview

### Current FlashScalper Architecture

```
FlashScalper
├── Exchange Client (AsterClient) - Binance-compatible API
├── Technical Analysis & Signals
├── Order Execution
├── Position Management
├── Memory/Learning System
└── LLM Integration
```

### Proposed Paradex Integration

```
FlashScalper (Multi-Exchange Support)
├── Exchange Abstraction Layer
│   ├── AsterClient (existing)
│   └── ParadexClient (NEW)
│       ├── REST API Client
│       ├── WebSocket Client
│       └── Starknet Account Management
├── Technical Analysis (reusable)
├── Order Execution (exchange-agnostic)
├── Position Management (exchange-agnostic)
├── Memory System (reusable)
└── LLM Integration (reusable)
```

---

## 3. Paradex API Overview

### Base URLs

- **Testnet**: `https://api.testnet.paradex.trade`
- **Production**: `https://api.paradex.trade`
- **WebSocket**: `wss://ws.api.paradex.trade` (prod) / `wss://ws.api.testnet.paradex.trade` (testnet)

### Authentication

Paradex uses **Starknet-based authentication**:

1. Derive a Starknet account from Ethereum private key
2. Sign messages with Starknet private key
3. Include signature in API requests

**Authentication Flow**:
```
Ethereum Private Key
  → Derive Starknet Account
  → Sign API requests
  → Include signature in headers
```

### API Endpoints (REST)

#### Public Endpoints (No Auth Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/system/config` | GET | System configuration |
| `/v1/markets` | GET | List all available markets |
| `/v1/markets/{symbol}` | GET | Get market details |
| `/v1/markets/{symbol}/orderbook` | GET | Get orderbook |
| `/v1/markets/{symbol}/trades` | GET | Get recent trades |
| `/v1/markets/{symbol}/funding` | GET | Get funding rates |
| `/v1/markets/{symbol}/summary` | GET | 24h market summary |

#### Private Endpoints (Auth Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/account` | GET | Get account info |
| `/v1/account/summary` | GET | Account summary with balances |
| `/v1/orders` | POST | Place new order |
| `/v1/orders` | GET | Get all orders |
| `/v1/orders/{id}` | GET | Get order details |
| `/v1/orders/{id}` | DELETE | Cancel order |
| `/v1/positions` | GET | Get all positions |
| `/v1/positions/{market}` | GET | Get position for market |
| `/v1/fills` | GET | Get trade history |
| `/v1/funding_payments` | GET | Get funding payments |

### WebSocket API

#### Public Channels

- **Markets**: Real-time market data
- **Orderbook**: Real-time orderbook updates  
- **Trades**: Real-time trade feed
- **Funding**: Real-time funding rate updates

#### Private Channels (Auth Required)

- **Orders**: Real-time order updates
- **Positions**: Real-time position updates
- **Fills**: Real-time trade fills
- **Account**: Real-time account updates

---

## 4. Implementation Plan

### Phase 1: Core Paradex Client (Week 1)

**Goal**: Implement basic Paradex exchange client with authentication

#### Tasks:

1. **Create Paradex Client Interface**
   - File: `src/services/execution/paradex-client.ts`
   - Implement Starknet account derivation
   - Implement signature-based authentication
   - Handle request signing

2. **Implement Public API Methods**
   - `getMarkets()` - List all markets
   - `getMarketInfo(symbol)` - Get market details
   - `getOrderbook(symbol)` - Get orderbook
   - `getTrades(symbol)` - Get recent trades
   - `getPrice(symbol)` - Get current market price

3. **Implement Private API Methods**
   - `getAccount()` - Get account info
   - `getBalance()` - Get account balance
   - `getPositions()` - Get open positions
   - `getPosition(symbol)` - Get specific position

4. **Add Configuration**
   - Add Paradex-specific config to `src/config/index.ts`
   - Environment variables:
     - `PARADEX_ENABLED=true/false`
     - `PARADEX_ENVIRONMENT=testnet/prod`
     - `PARADEX_PRIVATE_KEY=<ethereum_private_key>`
     - `PARADEX_API_BASE_URL=https://api.testnet.paradex.trade`

#### Dependencies:

- `@paradex/sdk` (already installed)
- `starknet` (peer dependency)
- `ethers` (already available)

#### Acceptance Criteria:

- ✅ Can authenticate with Paradex API
- ✅ Can fetch market data
- ✅ Can fetch account balances
- ✅ Can fetch positions
- ✅ Proper error handling and logging

---

### Phase 2: Order Execution (Week 2)

**Goal**: Implement order placement and management

#### Tasks:

1. **Implement Order Placement**
   - `placeMarketOrder(symbol, side, quantity)` - Place market order
   - `placeLimitOrder(symbol, side, quantity, price)` - Place limit order
   - `placeStopLossOrder(symbol, side, quantity, stopPrice)` - Place stop-loss

2. **Implement Order Management**
   - `cancelOrder(orderId)` - Cancel order
   - `cancelAllOrders()` - Cancel all orders
   - `getOrder(orderId)` - Get order status
   - `getOpenOrders()` - Get all open orders

3. **Add Order Validation**
   - Validate order size (min/max)
   - Validate price precision
   - Validate quantity precision
   - Check position limits

4. **Integrate with Existing Order Executor**
   - Update `src/services/execution/order-executor.ts`
   - Add exchange selection logic
   - Maintain backward compatibility with AsterClient

#### Acceptance Criteria:

- ✅ Can place market orders on Paradex
- ✅ Can place limit orders on Paradex
- ✅ Can cancel orders
- ✅ Orders are properly validated
- ✅ Integration with existing order executor

---

### Phase 3: Position Management & Live Trading (Week 3)

**Goal**: Enable live trading with position monitoring

#### Tasks:

1. **Implement Position Monitoring**
   - Real-time position updates
   - P&L calculation
   - Margin utilization tracking
   - Integration with existing position manager

2. **Implement Exit Logic**
   - Stop-loss execution
   - Take-profit execution
   - Trailing stop management
   - Emergency exit functionality

3. **Add Risk Management**
   - Position sizing for Paradex
   - Leverage management
   - Margin requirements
   - Daily loss limits

4. **Testing & Validation**
   - Test on Paradex testnet
   - Verify P&L calculations
   - Test order execution speed
   - Test position updates

#### Acceptance Criteria:

- ✅ Positions are monitored in real-time
- ✅ Stop-loss and take-profit work correctly
- ✅ Risk management rules are enforced
- ✅ Successfully executes trades on testnet

---

### Phase 4: WebSocket Integration (Week 4)

**Goal**: Add real-time data streaming for faster execution

#### Tasks:

1. **Implement WebSocket Client**
   - File: `src/services/execution/paradex-websocket.ts`
   - Connect to Paradex WebSocket
   - Handle authentication
   - Manage reconnections

2. **Subscribe to Public Channels**
   - Market data stream
   - Orderbook updates
   - Trade feed

3. **Subscribe to Private Channels**
   - Order updates
   - Position updates
   - Fill notifications
   - Account updates

4. **Integrate with Signal Generation**
   - Use WebSocket for real-time price data
   - Reduce API polling
   - Faster signal generation

#### Acceptance Criteria:

- ✅ WebSocket connection is stable
- ✅ Real-time updates are received
- ✅ Automatic reconnection works
- ✅ Improved execution speed

---

### Phase 5: Live Stream Integration (Week 5)

**Goal**: Prepare Paradex trading for live stream demonstrations

#### Tasks:

1. **Create Live Stream Dashboard**
   - Show Paradex positions
   - Show P&L in real-time
   - Show order flow
   - Show market conditions

2. **Add Stream Overlays**
   - Trade notifications
   - P&L updates
   - Position status
   - Signal confidence

3. **Implement Demo Mode**
   - Paper trading mode for demos
   - Replay mode for past trades
   - Safe mode with reduced risk

4. **Documentation & Training**
   - User guide for Paradex integration
   - Trading strategy documentation
   - Risk management guidelines

#### Acceptance Criteria:

- ✅ Dashboard shows Paradex data
- ✅ Stream overlays work correctly
- ✅ Demo mode is safe for live streams
- ✅ Documentation is complete

---

## 5. Technical Details

### Paradex Order Types

#### Market Order
```typescript
{
  "market": "BTC-USD-PERP",
  "type": "MARKET",
  "side": "BUY",
  "size": "0.1",
  "reduce_only": false
}
```

#### Limit Order
```typescript
{
  "market": "BTC-USD-PERP",
  "type": "LIMIT",
  "side": "BUY",
  "size": "0.1",
  "price": "95000",
  "time_in_force": "GTC", // Good Till Cancel
  "post_only": false,
  "reduce_only": false
}
```

#### Stop-Loss Order
```typescript
{
  "market": "BTC-USD-PERP",
  "type": "STOP_MARKET",
  "side": "SELL",
  "size": "0.1",
  "trigger_price": "94000",
  "reduce_only": true
}
```

### Market Precision

Each market has specific precision requirements:

```typescript
interface MarketInfo {
  symbol: string;
  order_size_increment: string; // e.g., "0.001"
  price_tick_size: string; // e.g., "0.1"
  min_notional: string; // e.g., "100"
  max_order_size: string; // e.g., "100"
  position_limit: string; // e.g., "30"
}
```

Example for BTC-USD-PERP:
- Min order size: 0.001 BTC
- Price tick: $0.1
- Min notional: $100
- Max position: 30 BTC

### Authentication Headers

```typescript
const headers = {
  'PARADEX-STARKNET-ACCOUNT': accountAddress,
  'PARADEX-STARKNET-SIGNATURE': signature,
  'PARADEX-TIMESTAMP': timestamp,
  'PARADEX-SIGNATURE-EXPIRATION': expiration,
  'Content-Type': 'application/json'
};
```

---

## 6. Configuration Changes

### Environment Variables

Add to `.env`:

```bash
# Paradex Configuration
PARADEX_ENABLED=true
PARADEX_ENVIRONMENT=testnet # or 'prod'
PARADEX_PRIVATE_KEY=<your_ethereum_private_key>
PARADEX_API_BASE_URL=https://api.testnet.paradex.trade
PARADEX_WS_BASE_URL=wss://ws.api.testnet.paradex.trade

# Paradex Trading Configuration
PARADEX_LEVERAGE=10
PARADEX_POSITION_SIZE_PERCENT=25
PARADEX_MAX_POSITIONS=10
PARADEX_TAKE_PROFIT_ROE=1.5
PARADEX_STOP_LOSS_ROE=-0.5
```

### Config Updates

Update `src/config/index.ts`:

```typescript
export const config = {
  // ... existing config
  
  paradex: {
    enabled: env.PARADEX_ENABLED === 'true',
    environment: env.PARADEX_ENVIRONMENT || 'testnet',
    privateKey: env.PARADEX_PRIVATE_KEY || '',
    apiBaseUrl: env.PARADEX_API_BASE_URL,
    wsBaseUrl: env.PARADEX_WS_BASE_URL,
  },
};
```

---

## 7. Type Definitions

Add to `src/types/index.ts`:

```typescript
// Paradex-specific types
export type ParadexEnvironment = 'testnet' | 'prod';

export interface ParadexConfig {
  enabled: boolean;
  environment: ParadexEnvironment;
  privateKey: string;
  apiBaseUrl: string;
  wsBaseUrl: string;
}

export interface ParadexMarket {
  symbol: string;
  base_currency: string;
  quote_currency: string;
  settlement_currency: string;
  order_size_increment: string;
  price_tick_size: string;
  min_notional: string;
  max_order_size: string;
  position_limit: string;
  asset_kind: 'PERP' | 'PERP_OPTION';
  market_kind: 'cross' | 'isolated';
}

export interface ParadexOrder {
  id: string;
  market: string;
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  side: 'BUY' | 'SELL';
  size: string;
  price?: string;
  trigger_price?: string;
  time_in_force?: 'GTC' | 'IOC' | 'FOK';
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED';
  filled_size: string;
  average_fill_price?: string;
  created_at: number;
}

export interface ParadexPosition {
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entry_price: string;
  mark_price: string;
  liquidation_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  leverage: string;
  margin: string;
}
```

---

## 8. Testing Strategy

### Unit Tests

1. **Paradex Client Tests**
   - Test authentication
   - Test API request signing
   - Test error handling
   - Test retry logic

2. **Order Validation Tests**
   - Test size validation
   - Test price precision
   - Test market availability

### Integration Tests

1. **Testnet Trading**
   - Place market orders
   - Place limit orders
   - Cancel orders
   - Monitor positions

2. **WebSocket Tests**
   - Test connection
   - Test subscriptions
   - Test message handling
   - Test reconnection

### Live Testing

1. **Paper Trading Mode**
   - Test with simulated orders
   - Verify P&L calculations
   - Test risk management

2. **Small Live Orders**
   - Start with minimum position sizes
   - Verify actual execution
   - Monitor performance

---

## 9. Risk Considerations

### Trading Risks

1. **Network Delays**: Starknet L2 adds latency vs CEX
2. **Gas Fees**: Network fees for on-chain operations
3. **Liquidity**: May vary by market
4. **Slippage**: Consider in volatile markets

### Mitigation Strategies

1. **Use Limit Orders**: Reduce slippage
2. **Monitor Liquidity**: Check orderbook depth
3. **Conservative Position Sizing**: Start small
4. **Stop-Loss Always**: Never trade without stops

---

## 10. Success Metrics

### Technical Metrics

- ✅ Order execution time < 2s
- ✅ WebSocket uptime > 99%
- ✅ API error rate < 1%
- ✅ Position sync accuracy 100%

### Trading Metrics

- ✅ Win rate > 55%
- ✅ Average trade duration < 10 minutes
- ✅ Maximum drawdown < 10%
- ✅ Sharpe ratio > 1.5

---

## 11. Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Core Client | Week 1 | 🔄 Ready to Start |
| Phase 2: Order Execution | Week 2 | ⏳ Pending |
| Phase 3: Position Management | Week 3 | ⏳ Pending |
| Phase 4: WebSocket Integration | Week 4 | ⏳ Pending |
| Phase 5: Live Stream Ready | Week 5 | ⏳ Pending |

**Total Duration**: 5 weeks

---

## 12. Resources

### Documentation

- [Paradex Docs](https://docs.paradex.trade)
- [Paradex SDK](https://github.com/tradeparadex/paradex.js)
- [Starknet Docs](https://docs.starknet.io)

### API References

- [REST API Reference](https://docs.paradex.trade/api/general-information)
- [WebSocket API Reference](https://docs.paradex.trade/ws/general-information)

### Community

- [Discord](https://discord.gg/paradex)
- [Twitter](https://twitter.com/tradeparadex)

---

## 13. Next Steps

1. ✅ **Review this plan** with the team
2. 🔄 **Set up testnet account** and get test USDC
3. ⏳ **Start Phase 1** implementation
4. ⏳ **Test on testnet** before production
5. ⏳ **Deploy to production** after thorough testing

---

## Notes

- Start with **testnet** only
- Use **paper trading mode** for initial testing
- Monitor **gas costs** on Starknet
- Consider **Paradex-specific optimizations** (zero fees, no MEV)
- Leverage **existing FlashScalper components** (technical analysis, memory system, LLM)

---

*Last Updated: December 23, 2025*
