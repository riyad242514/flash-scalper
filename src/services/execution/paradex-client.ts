/**
 * Paradex Exchange Client
 * Handles all Paradex API communication with proper authentication
 */

import * as Paradex from '@paradex/sdk';
import { ethers } from 'ethers';
import { config } from '../../config';
import { executionLogger } from '../../utils/logger';
import { exchangeRequests, exchangeLatency, exchangeErrors } from '../../utils/metrics';
import type {
  OrderRequest,
  OrderResult,
  ExchangeCredentials,
  ParadexConfig,
  ParadexMarket,
  ParadexOrder,
  ParadexPosition,
} from '../../types';

// Starknet typed data for Paradex auth
interface ParadexAuthTypedData {
  types: {
    StarkNetDomain: Array<{ name: string; type: string }>;
    Request: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  domain: {
    name: string;
    chainId: string;
    version: string;
  };
  message: {
    method: string;
    path: string;
    body: string;
    timestamp: string;
    expiration: string;
  };
}

// Paradex API response formats
interface ParadexApiResponse<T> {
  results?: T[];
  data?: T;
  error?: string;
}

interface ParadexAccountSummary {
  account: string;
  equity: string;
  free_collateral: string;
  used_margin: string;
  unrealized_pnl: string;
  positions: any[];
}

// =============================================================================
// PARADEX CLIENT
// =============================================================================

export class ParadexClient {
  private client: Paradex.ParadexClient | null = null;
  private config: Paradex.ParadexConfig | null = null;
  private paradexConfig: ParadexConfig;
  private marketsCache: Map<string, ParadexMarket> = new Map();
  private lastMarketsFetch: number = 0;
  private jwtToken: string | null = null;
  private jwtExpiry: number = 0;
  private ethereumAddress: string = '';

  constructor(paradexConfig?: Partial<ParadexConfig>) {
    this.paradexConfig = {
      enabled: paradexConfig?.enabled ?? (config as any).paradex?.enabled ?? false,
      environment: paradexConfig?.environment ?? (config as any).paradex?.environment ?? 'testnet',
      privateKey: paradexConfig?.privateKey ?? (config as any).paradex?.privateKey ?? '',
      apiBaseUrl: paradexConfig?.apiBaseUrl ?? (config as any).paradex?.apiBaseUrl ?? 'https://api.testnet.paradex.trade',
      wsBaseUrl: paradexConfig?.wsBaseUrl ?? (config as any).paradex?.wsBaseUrl,
    };

    if (!this.paradexConfig.enabled) {
      executionLogger.warn('Paradex is disabled in configuration');
    }
  }

  /**
   * Initialize the Paradex client with authentication
   */
  async initialize(): Promise<void> {
    try {
      executionLogger.info({
        environment: this.paradexConfig.environment,
      }, 'Initializing Paradex client');

      // Fetch Paradex configuration
      this.config = await Paradex.Config.fetch(this.paradexConfig.environment);

      // Create wallet from private key
      const wallet = new ethers.Wallet(this.paradexConfig.privateKey);
      this.ethereumAddress = wallet.address;
      const signer = Paradex.Signer.fromEthers(wallet);

      // Create Paradex client
      this.client = await Paradex.Client.fromEthSigner({
        config: this.config,
        signer,
      });

      executionLogger.info({
        account: this.client.getAddress(),
        ethereumAddress: this.ethereumAddress,
      }, 'Paradex client initialized successfully');

      // Authenticate to get JWT token (auto-onboards if needed)
      await this.authenticate();

      // Load markets
      await this.loadMarkets();
    } catch (error: any) {
      executionLogger.error({
        error: error.message,
      }, 'Failed to initialize Paradex client');
      throw error;
    }
  }

  /**
   * Check if client is initialized
   */
  private ensureInitialized(): void {
    if (!this.client) {
      throw new Error('Paradex client not initialized. Call initialize() first.');
    }
  }

  /**
   * Onboard the account to Paradex (register the StarkNet account)
   */
  private async onboard(): Promise<void> {
    this.ensureInitialized();

    const { ec, typedData: starkTypedData, shortString } = await import('starknet');
    // Use Paradex chain ID and encode it (matching Paradex code samples exactly)
    const chainId = shortString.encodeShortString(this.config!.paradexChainId);
    const account = (this.client as any).account;

    // Build onboarding typed data (exact format from Paradex code samples)
    const onboardingTypedData = {
      types: {
        StarkNetDomain: [
          { name: 'name', type: 'felt' },
          { name: 'chainId', type: 'felt' },
          { name: 'version', type: 'felt' },
        ],
        Constant: [{ name: 'action', type: 'felt' }],
      },
      primaryType: 'Constant',
      domain: {
        name: 'Paradex',
        chainId: chainId,
        version: '1',
      },
      message: {
        action: 'Onboarding',
      },
    };

    // Get private key from the account's signer (stored as 'pk' in StarkNet.js)
    const privateKey = account.signer?.pk || account.signer?.privateKey || account.privateKey;
    if (!privateKey) {
      throw new Error('Cannot get StarkNet private key for onboarding');
    }

    // Get public key from private key
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    const starknetAddress = this.client!.getAddress();

    // Sign using direct starkCurve signing (matching Paradex code samples exactly)
    const msgHash = starkTypedData.getMessageHash(onboardingTypedData, starknetAddress);
    const { r, s } = ec.starkCurve.sign(msgHash, privateKey);
    const signatureStr = JSON.stringify([r.toString(), s.toString()]);

    // Use milliseconds like their code does
    const timestamp = Date.now();

    executionLogger.debug({ publicKey, starknetAddress }, 'Onboarding with credentials');

    // Make onboarding request
    const response = await fetch(`${this.paradexConfig.apiBaseUrl}/v1/onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'PARADEX-ETHEREUM-ACCOUNT': this.ethereumAddress,
        'PARADEX-STARKNET-ACCOUNT': starknetAddress,
        'PARADEX-STARKNET-SIGNATURE': signatureStr,
        'PARADEX-TIMESTAMP': timestamp.toString(),
      },
      body: JSON.stringify({
        public_key: publicKey,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      // Provide helpful error message for insufficient balance
      if (errorBody.includes('INSUFFICIENT_MIN_CHAIN_BALANCE')) {
        throw new Error(
          `Paradex onboarding requires your Ethereum wallet (${this.ethereumAddress}) to have at least 0.001 ETH or 5 USDC ` +
          `on Ethereum, Arbitrum, or Base mainnet. This is a one-time requirement to prevent spam account creation.`
        );
      }

      throw new Error(`Onboarding failed: ${response.status} ${errorBody}`);
    }

    executionLogger.info('Paradex onboarding successful');
  }

  /**
   * Authenticate and get JWT token
   */
  private async authenticate(): Promise<void> {
    this.ensureInitialized();

    try {
      const { ec, typedData: starkTypedData, shortString } = await import('starknet');

      // Get current timestamp and expiry (7 days from now, matching Paradex samples)
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 7 * 24 * 60 * 60; // 7 days

      // Build the typed data for signing (use Paradex chain ID, encoded)
      const chainId = shortString.encodeShortString(this.config!.paradexChainId);
      const typedData = {
        types: {
          StarkNetDomain: [
            { name: 'name', type: 'felt' },
            { name: 'chainId', type: 'felt' },
            { name: 'version', type: 'felt' },
          ],
          Request: [
            { name: 'method', type: 'felt' },
            { name: 'path', type: 'felt' },
            { name: 'body', type: 'felt' },
            { name: 'timestamp', type: 'felt' },
            { name: 'expiration', type: 'felt' },
          ],
        },
        primaryType: 'Request',
        domain: {
          name: 'Paradex',
          chainId: chainId,
          version: '1',
        },
        message: {
          method: 'POST',
          path: '/v1/auth',
          body: '',
          timestamp: now,
          expiration: expiry,
        },
      };

      // Get the account and private key from the SDK client (stored as 'pk' in StarkNet.js)
      const account = (this.client as any).account;
      const privateKey = account.signer?.pk || account.signer?.privateKey || account.privateKey;
      if (!privateKey) {
        throw new Error('Cannot get StarkNet private key for authentication');
      }

      const starknetAddress = this.client!.getAddress();

      // Sign using direct starkCurve signing (matching Paradex code samples exactly)
      const msgHash = starkTypedData.getMessageHash(typedData, starknetAddress);
      const { r, s } = ec.starkCurve.sign(msgHash, privateKey);
      const signatureStr = JSON.stringify([r.toString(), s.toString()]);

      // Make auth request
      const response = await fetch(`${this.paradexConfig.apiBaseUrl}/v1/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PARADEX-STARKNET-ACCOUNT': starknetAddress,
          'PARADEX-STARKNET-SIGNATURE': signatureStr,
          'PARADEX-TIMESTAMP': now.toString(),
          'PARADEX-SIGNATURE-EXPIRATION': expiry.toString(),
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();

        // Check if user needs to be onboarded first - auto-onboard
        if (response.status === 400 && errorBody.includes('NOT_ONBOARDED')) {
          executionLogger.info('Account not onboarded, performing auto-onboarding...');
          await this.onboard();
          // Retry authentication after onboarding
          return this.authenticate();
        }

        throw new Error(`Authentication failed: ${response.status} ${errorBody}`);
      }

      const data = await response.json() as { jwt_token: string };
      this.jwtToken = data.jwt_token;
      this.jwtExpiry = expiry * 1000; // Convert to milliseconds

      executionLogger.info('Paradex JWT authentication successful');
    } catch (error: any) {
      executionLogger.error({ error: error.message }, 'Paradex authentication failed');
      throw error;
    }
  }

  /**
   * Ensure JWT token is valid, refresh if needed
   */
  private async ensureAuthenticated(): Promise<void> {
    // Refresh JWT if expired or expiring within 1 minute
    if (!this.jwtToken || Date.now() > this.jwtExpiry - 60000) {
      await this.authenticate();
    }
  }

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  /**
   * Load and cache market information
   */
  async loadMarkets(): Promise<void> {
    const startTime = Date.now();

    try {
      const response = await this.request<ParadexApiResponse<ParadexMarket>>(
        'GET',
        '/v1/markets',
        null,
        false
      );

      if (response.results) {
        // Cache markets
        for (const market of response.results) {
          this.marketsCache.set(market.symbol, market);
        }
        this.lastMarketsFetch = Date.now();

        executionLogger.info({
          count: response.results.length,
        }, 'Loaded Paradex markets');
      }

      const latency = Date.now() - startTime;
      exchangeLatency.observe({ exchange: 'paradex', endpoint: '/v1/markets' }, latency);
      exchangeRequests.inc({ exchange: 'paradex', endpoint: '/v1/markets', status: 'success' });
    } catch (error: any) {
      exchangeErrors.inc({ exchange: 'paradex', endpoint: '/v1/markets', error_type: 'fetch_markets' });
      executionLogger.error({ error: error.message }, 'Failed to load markets');
      throw error;
    }
  }

  /**
   * Get all available markets
   */
  async getMarkets(): Promise<ParadexMarket[]> {
    // Refresh markets if cache is stale (> 5 minutes)
    if (Date.now() - this.lastMarketsFetch > 300000) {
      await this.loadMarkets();
    }
    return Array.from(this.marketsCache.values());
  }

  /**
   * Get specific market information
   */
  async getMarketInfo(symbol: string): Promise<ParadexMarket | null> {
    const market = this.marketsCache.get(symbol);
    if (!market && Date.now() - this.lastMarketsFetch > 300000) {
      await this.loadMarkets();
      return this.marketsCache.get(symbol) || null;
    }
    return market || null;
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<number> {
    const startTime = Date.now();

    try {
      const response = await this.request<{ mark_price: string }>(
        'GET',
        `/v1/markets/${symbol}/summary`,
        null,
        false
      );

      const latency = Date.now() - startTime;
      exchangeLatency.observe({ exchange: 'paradex', endpoint: '/v1/markets/summary' }, latency);

      return parseFloat(response.mark_price);
    } catch (error: any) {
      exchangeErrors.inc({ exchange: 'paradex', endpoint: '/v1/markets/summary', error_type: 'price_fetch' });
      throw error;
    }
  }

  /**
   * Get orderbook for a symbol
   */
  async getOrderbook(symbol: string): Promise<any> {
    return this.request('GET', `/v1/markets/${symbol}/orderbook`, null, false);
  }

  /**
   * Get recent trades for a symbol
   */
  async getTrades(symbol: string, limit: number = 100): Promise<any[]> {
    const response = await this.request<ParadexApiResponse<any>>(
      'GET',
      `/v1/markets/${symbol}/trades?limit=${limit}`,
      null,
      false
    );
    return response.results || [];
  }

  // =============================================================================
  // PRIVATE API METHODS (AUTHENTICATED)
  // =============================================================================

  /**
   * Get account information
   */
  async getAccount(): Promise<ParadexAccountSummary> {
    this.ensureInitialized();
    return this.request<ParadexAccountSummary>('GET', '/v1/account/summary', null, true);
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ balance: number; unrealizedPnL: number }> {
    this.ensureInitialized();

    const account = await this.getAccount();
    
    return {
      balance: parseFloat(account.equity),
      unrealizedPnL: parseFloat(account.unrealized_pnl),
    };
  }

  /**
   * Get all positions
   */
  async getPositions(): Promise<ParadexPosition[]> {
    this.ensureInitialized();

    const response = await this.request<ParadexApiResponse<ParadexPosition>>(
      'GET',
      '/v1/positions',
      null,
      true
    );

    return response.results || [];
  }

  /**
   * Get position for a specific symbol
   */
  async getPosition(symbol: string): Promise<ParadexPosition | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.market === symbol) || null;
  }

  // =============================================================================
  // ORDER METHODS
  // =============================================================================

  /**
   * Place market order
   */
  async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly: boolean = false
  ): Promise<OrderResult> {
    this.ensureInitialized();

    const formattedQuantity = this.formatQuantity(symbol, quantity);
    const startTime = Date.now();

    try {
      const orderPayload = {
        market: symbol,
        type: 'MARKET',
        side,
        size: formattedQuantity,
        reduce_only: reduceOnly,
      };

      const order = await this.request<ParadexOrder>(
        'POST',
        '/v1/orders',
        orderPayload,
        true
      );

      const latency = Date.now() - startTime;
      exchangeLatency.observe({ exchange: 'paradex', endpoint: '/v1/orders' }, latency);
      exchangeRequests.inc({ exchange: 'paradex', endpoint: '/v1/orders', status: 'success' });

      return {
        success: true,
        orderId: order.id,
        filledPrice: order.average_fill_price ? parseFloat(order.average_fill_price) : 0,
        filledQuantity: parseFloat(order.filled_size),
        fees: 0, // Paradex has zero trading fees
      };
    } catch (error: any) {
      exchangeErrors.inc({ exchange: 'paradex', endpoint: '/v1/orders', error_type: 'order_placement' });
      executionLogger.error({
        symbol,
        side,
        quantity: formattedQuantity,
        error: error.message,
      }, 'Paradex order failed');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    reduceOnly: boolean = false
  ): Promise<OrderResult> {
    this.ensureInitialized();

    const formattedQuantity = this.formatQuantity(symbol, quantity);
    const formattedPrice = this.formatPrice(symbol, price);

    try {
      const orderPayload = {
        market: symbol,
        type: 'LIMIT',
        side,
        size: formattedQuantity,
        price: formattedPrice,
        time_in_force: 'GTC',
        reduce_only: reduceOnly,
      };

      const order = await this.request<ParadexOrder>(
        'POST',
        '/v1/orders',
        orderPayload,
        true
      );

      return {
        success: true,
        orderId: order.id,
        filledPrice: order.average_fill_price ? parseFloat(order.average_fill_price) : price,
        filledQuantity: parseFloat(order.filled_size),
        fees: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      await this.request('DELETE', `/v1/orders/${orderId}`, null, true);
      executionLogger.debug({ orderId, symbol }, 'Order cancelled');
      return true;
    } catch (error: any) {
      executionLogger.error({ orderId, error: error.message }, 'Failed to cancel order');
      return false;
    }
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(): Promise<ParadexOrder[]> {
    this.ensureInitialized();

    const response = await this.request<ParadexApiResponse<ParadexOrder>>(
      'GET',
      '/v1/orders?status=OPEN',
      null,
      true
    );

    return response.results || [];
  }

  /**
   * Check if order exists
   */
  async orderExists(symbol: string, orderId: string): Promise<boolean> {
    try {
      const order = await this.request<ParadexOrder>(
        'GET',
        `/v1/orders/${orderId}`,
        null,
        true
      );
      return !!order;
    } catch (error) {
      return false;
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Get minimum quantity and precision for a symbol
   */
  getMinQtyAndPrecision(symbol: string): { min: number; precision: number } {
    const market = this.marketsCache.get(symbol);
    
    if (market) {
      const increment = parseFloat(market.order_size_increment);
      const precision = this.getPrecisionFromIncrement(increment);
      const minNotional = parseFloat(market.min_notional);
      
      return {
        min: increment,
        precision,
      };
    }

    // Fallback defaults
    return { min: 0.001, precision: 3 };
  }

  /**
   * Calculate precision from increment
   */
  private getPrecisionFromIncrement(increment: number): number {
    const incrementStr = increment.toString();
    if (incrementStr.includes('.')) {
      return incrementStr.split('.')[1].length;
    }
    return 0;
  }

  /**
   * Round quantity to symbol's precision
   */
  roundQuantity(symbol: string, quantity: number): number {
    const { precision, min } = this.getMinQtyAndPrecision(symbol);
    
    if (precision === 0) {
      return Math.max(min, Math.floor(quantity));
    }
    
    const multiplier = Math.pow(10, precision);
    const rounded = Math.floor(quantity * multiplier) / multiplier;
    return Math.max(min, rounded);
  }

  /**
   * Format quantity as string with correct precision
   */
  formatQuantity(symbol: string, quantity: number): string {
    const { precision } = this.getMinQtyAndPrecision(symbol);
    const rounded = this.roundQuantity(symbol, quantity);
    
    if (precision === 0) {
      return Math.floor(rounded).toString();
    }
    
    return rounded.toFixed(precision);
  }

  /**
   * Format price as string with correct precision
   */
  formatPrice(symbol: string, price: number): string {
    const market = this.marketsCache.get(symbol);
    
    if (market) {
      const tickSize = parseFloat(market.price_tick_size);
      const precision = this.getPrecisionFromIncrement(tickSize);
      const rounded = Math.floor(price / tickSize) * tickSize;
      return rounded.toFixed(precision);
    }

    // Fallback: 2 decimal places
    return price.toFixed(2);
  }

  /**
   * Get account address
   */
  getAddress(): string {
    this.ensureInitialized();
    return this.client!.getAddress();
  }

  // =============================================================================
  // HTTP REQUEST WRAPPER
  // =============================================================================

  /**
   * Make HTTP request to Paradex API
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    body: any = null,
    authenticated: boolean = false,
    retries: number = 3
  ): Promise<T> {
    const url = `${this.paradexConfig.apiBaseUrl}${endpoint}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Ensure we have a valid JWT for authenticated requests
        if (authenticated) {
          await this.ensureAuthenticated();
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add JWT token for authenticated requests
        if (authenticated && this.jwtToken) {
          headers['Authorization'] = `Bearer ${this.jwtToken}`;
        }

        const options: RequestInit = {
          method,
          headers,
        };

        if (body && method === 'POST') {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Paradex API error ${response.status}: ${errorBody}`);
        }

        return response.json() as Promise<T>;
      } catch (error: any) {
        const isLastAttempt = attempt === retries;

        if (isLastAttempt) {
          executionLogger.error({
            method,
            endpoint,
            error: error.message,
          }, 'Paradex request failed after all retries');
          throw error;
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    throw new Error('Request failed after all retries');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createParadexClient(credentials?: ExchangeCredentials): ParadexClient {
  if (credentials) {
    return new ParadexClient({
      privateKey: credentials.secretKey,
    });
  }
  return new ParadexClient();
}
