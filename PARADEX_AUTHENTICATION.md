# Paradex Authentication Guide

## Overview

Paradex uses Starknet-based authentication for API requests. This guide explains how authentication works and how to implement it.

---

## Authentication Flow

```
┌─────────────────┐
│ Ethereum Wallet │
│   Private Key   │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│ Derive Starknet     │
│ Account & Keys      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Sign API Request    │
│ with Starknet Key   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Send Request with   │
│ Signature Headers   │
└─────────────────────┘
```

---

## Step 1: Account Derivation

Paradex uses a deterministic derivation from an Ethereum private key to a Starknet account.

### Using Paradex SDK

```typescript
import * as Paradex from '@paradex/sdk';
import { ethers } from 'ethers';

// 1. Load Ethereum private key
const privateKey = process.env.PARADEX_PRIVATE_KEY;
const wallet = new ethers.Wallet(privateKey);

// 2. Convert to Paradex signer
const signer = Paradex.Signer.fromEthers(wallet);

// 3. Fetch Paradex config
const config = await Paradex.Config.fetch('testnet'); // or 'prod'

// 4. Create Paradex client (handles account derivation internally)
const client = await Paradex.Client.fromEthSigner({ config, signer });

// 5. Get Starknet account address
const accountAddress = client.getAddress();
console.log('Paradex Account:', accountAddress);
```

### Manual Derivation (Advanced)

If you need to derive the account manually:

```typescript
import { Account, ec } from 'starknet';
import { grindKey } from '@starkware-industries/starkware-crypto-utils';

// Derive Starknet private key from Ethereum private key
function deriveStarknetPrivateKey(ethPrivateKey: string): string {
  const ethPrivateKeyBN = BigInt(ethPrivateKey);
  const starknetPrivateKey = grindKey(ethPrivateKeyBN);
  return `0x${starknetPrivateKey.toString(16)}`;
}

// Example
const ethPrivateKey = '0x1234...';
const starknetPrivateKey = deriveStarknetPrivateKey(ethPrivateKey);
```

---

## Step 2: Request Signing

### Authentication Headers

Every authenticated request must include these headers:

```typescript
{
  'PARADEX-STARKNET-ACCOUNT': '<your_starknet_account_address>',
  'PARADEX-STARKNET-SIGNATURE': '<signature>',
  'PARADEX-TIMESTAMP': '<current_timestamp_ms>',
  'PARADEX-SIGNATURE-EXPIRATION': '<expiration_timestamp_ms>',
  'Content-Type': 'application/json'
}
```

### Signature Format

The signature is computed over a message that includes:
- HTTP method (GET, POST, DELETE, etc.)
- Request path
- Timestamp
- Request body (if POST/PUT)

### Example Signature Generation

```typescript
import { Account, hash, typedData } from 'starknet';

async function signRequest(
  method: string,
  path: string,
  timestamp: number,
  body?: any,
  account: Account
): Promise<string> {
  // 1. Build message to sign
  const message = {
    method,
    path,
    timestamp,
    body: body ? JSON.stringify(body) : '',
  };

  // 2. Sign message with Starknet account
  const signature = await account.signMessage(message);

  // 3. Return signature as hex string
  return signature.join(','); // Array of signature components
}
```

---

## Step 3: Making Authenticated Requests

### Example: Get Account Summary

```typescript
async function getAccountSummary(client: Paradex.ParadexClient) {
  const provider = client.getProvider();
  
  // SDK handles authentication automatically
  const response = await provider.callContract({
    contractAddress: config.paraclearAddress,
    entrypoint: 'get_account_summary',
    calldata: [client.getAddress()],
  });

  return response;
}
```

### Example: Place Order (Manual Auth)

```typescript
async function placeOrder(
  market: string,
  side: 'BUY' | 'SELL',
  size: string,
  account: Account,
  apiBaseUrl: string
) {
  const timestamp = Date.now();
  const expiration = timestamp + 60000; // 1 minute expiration

  const orderPayload = {
    market,
    type: 'MARKET',
    side,
    size,
  };

  // Sign request
  const signature = await signRequest(
    'POST',
    '/v1/orders',
    timestamp,
    orderPayload,
    account
  );

  // Make request
  const response = await fetch(`${apiBaseUrl}/v1/orders`, {
    method: 'POST',
    headers: {
      'PARADEX-STARKNET-ACCOUNT': account.address,
      'PARADEX-STARKNET-SIGNATURE': signature,
      'PARADEX-TIMESTAMP': timestamp.toString(),
      'PARADEX-SIGNATURE-EXPIRATION': expiration.toString(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderPayload),
  });

  return response.json();
}
```

---

## Step 4: WebSocket Authentication

WebSocket connections also require authentication.

### Connection Setup

```typescript
import WebSocket from 'ws';

async function connectWebSocket(
  account: Account,
  wsUrl: string
): Promise<WebSocket> {
  // 1. Generate auth message
  const timestamp = Date.now();
  const authMessage = {
    method: 'WS',
    path: '/',
    timestamp,
  };

  // 2. Sign auth message
  const signature = await account.signMessage(authMessage);

  // 3. Connect to WebSocket
  const ws = new WebSocket(wsUrl);

  // 4. Send auth after connection
  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'auth',
      account: account.address,
      signature: signature.join(','),
      timestamp,
    }));
  });

  return ws;
}
```

### Subscribe to Private Channels

```typescript
// After authentication
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'orders',
}));

ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'positions',
}));

ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'fills',
}));
```

---

## Security Best Practices

### 1. Protect Private Keys

```typescript
// ❌ DON'T: Hardcode private keys
const privateKey = '0x1234...';

// ✅ DO: Use environment variables
const privateKey = process.env.PARADEX_PRIVATE_KEY;
if (!privateKey) {
  throw new Error('PARADEX_PRIVATE_KEY not set');
}
```

### 2. Use Short Expiration Times

```typescript
// ✅ Signatures should expire quickly (1-5 minutes)
const expiration = Date.now() + 60000; // 1 minute
```

### 3. Verify Responses

```typescript
// ✅ Always verify API responses
const response = await fetch(url, options);
if (!response.ok) {
  throw new Error(`API error: ${response.statusText}`);
}
```

### 4. Handle Auth Errors

```typescript
// ✅ Implement retry logic for auth errors
async function makeAuthenticatedRequest(
  url: string,
  options: RequestInit
): Promise<Response> {
  const response = await fetch(url, options);
  
  if (response.status === 401) {
    // Re-authenticate and retry
    console.warn('Authentication failed, retrying...');
    // ... refresh auth and retry
  }
  
  return response;
}
```

---

## Common Issues & Solutions

### Issue 1: "Invalid Signature"

**Cause**: Signature doesn't match message or account

**Solution**:
- Verify account derivation is correct
- Check timestamp is current
- Ensure message format matches exactly
- Verify private key is correct

```typescript
// Debug signature
console.log('Account:', account.address);
console.log('Timestamp:', timestamp);
console.log('Message:', JSON.stringify(message));
console.log('Signature:', signature);
```

### Issue 2: "Signature Expired"

**Cause**: Timestamp or expiration is too old

**Solution**:
- Use current timestamp (`Date.now()`)
- Don't cache signatures
- Generate fresh signature for each request

```typescript
// ✅ Always generate fresh timestamps
const timestamp = Date.now();
const expiration = timestamp + 60000;
```

### Issue 3: "Account Not Found"

**Cause**: Account not yet deployed on Starknet

**Solution**:
- For testnet: Request test tokens to deploy account
- For production: Deposit funds to deploy account
- Account is automatically deployed on first deposit

### Issue 4: "Rate Limit Exceeded"

**Cause**: Too many requests in short period

**Solution**:
- Implement rate limiting
- Use WebSocket for real-time data
- Cache responses when possible

```typescript
// Rate limiter example
const rateLimiter = new TokenBucket(
  60, // 60 requests
  60000 // per minute
);

await rateLimiter.acquire();
const response = await makeRequest();
```

---

## Testing Authentication

### Test on Testnet First

```bash
# Set testnet environment
export PARADEX_ENVIRONMENT=testnet
export PARADEX_PRIVATE_KEY=0x... # Your test private key
export PARADEX_API_BASE_URL=https://api.testnet.paradex.trade
```

### Verify Account Access

```typescript
import * as Paradex from '@paradex/sdk';

async function testAuth() {
  try {
    // 1. Setup client
    const config = await Paradex.Config.fetch('testnet');
    const wallet = new ethers.Wallet(process.env.PARADEX_PRIVATE_KEY!);
    const signer = Paradex.Signer.fromEthers(wallet);
    const client = await Paradex.Client.fromEthSigner({ config, signer });

    // 2. Test authentication
    console.log('✅ Account address:', client.getAddress());

    // 3. Test API access
    const balance = await client.getTokenBalance('USDC');
    console.log('✅ USDC balance:', balance.size);

    console.log('✅ Authentication working!');
  } catch (error) {
    console.error('❌ Authentication failed:', error);
  }
}

testAuth();
```

---

## Production Checklist

Before going to production:

- [ ] Tested on testnet
- [ ] Private keys stored securely
- [ ] Rate limiting implemented
- [ ] Error handling implemented
- [ ] Retry logic implemented
- [ ] Logging configured
- [ ] Monitoring alerts set up
- [ ] Backup keys stored safely
- [ ] Team trained on key management
- [ ] Incident response plan ready

---

## Example: Complete Authentication Flow

```typescript
import * as Paradex from '@paradex/sdk';
import { ethers } from 'ethers';

class ParadexAuthenticator {
  private client: Paradex.ParadexClient | null = null;
  private config: Paradex.ParadexConfig | null = null;

  async initialize(
    privateKey: string,
    environment: 'testnet' | 'prod'
  ): Promise<void> {
    // 1. Fetch config
    this.config = await Paradex.Config.fetch(environment);

    // 2. Create wallet
    const wallet = new ethers.Wallet(privateKey);
    const signer = Paradex.Signer.fromEthers(wallet);

    // 3. Create client
    this.client = await Paradex.Client.fromEthSigner({
      config: this.config,
      signer,
    });

    console.log('✅ Initialized with account:', this.client.getAddress());
  }

  getClient(): Paradex.ParadexClient {
    if (!this.client) {
      throw new Error('Authenticator not initialized');
    }
    return this.client;
  }

  getAccountAddress(): string {
    return this.getClient().getAddress();
  }

  async testConnection(): Promise<boolean> {
    try {
      const balance = await this.client!.getTokenBalance('USDC');
      console.log('✅ Connection test passed');
      return true;
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      return false;
    }
  }
}

// Usage
const auth = new ParadexAuthenticator();
await auth.initialize(
  process.env.PARADEX_PRIVATE_KEY!,
  'testnet'
);
console.log('Account:', auth.getAccountAddress());
await auth.testConnection();
```

---

## Additional Resources

- [Paradex Authentication Docs](https://docs.paradex.trade/api/general-information/authentication)
- [Starknet Account Abstraction](https://docs.starknet.io/documentation/architecture_and_concepts/Account_Abstraction)
- [Starknet.js Documentation](https://starknetjs.com)

---

*Last Updated: December 23, 2025*
