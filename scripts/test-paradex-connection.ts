/**
 * Test Paradex Connection
 * 
 * This script tests the Paradex client connection and authentication.
 * 
 * Usage:
 *   npm run build && node dist/scripts/test-paradex-connection.js
 */

import { ParadexClient } from '../src/services/execution/paradex-client';
import { executionLogger } from '../src/utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

async function testParadexConnection() {
  console.log('🚀 Testing Paradex Connection...\n');

  try {
    // 1. Create client
    console.log('📦 Creating Paradex client...');
    const client = new ParadexClient({
      enabled: true,
      environment: (process.env.PARADEX_ENVIRONMENT || 'testnet') as 'testnet' | 'prod',
      privateKey: process.env.PARADEX_PRIVATE_KEY || '',
      apiBaseUrl: process.env.PARADEX_API_BASE_URL || 'https://api.testnet.paradex.trade',
    });

    // 2. Initialize
    console.log('🔑 Initializing client (deriving Starknet account)...');
    await client.initialize();
    console.log('✅ Client initialized successfully\n');

    // 3. Get account address
    const address = client.getAddress();
    console.log('📍 Paradex Account Address:', address);

    // 4. Load markets
    console.log('\n📊 Loading markets...');
    const markets = await client.getMarkets();
    console.log(`✅ Loaded ${markets.length} markets`);
    
    // Show first 5 perpetual markets
    const perpMarkets = markets.filter(m => m.asset_kind === 'PERP').slice(0, 5);
    console.log('\n🎯 Sample Perpetual Markets:');
    perpMarkets.forEach(market => {
      console.log(`  - ${market.symbol}: ${market.base_currency}/${market.quote_currency}`);
    });

    // 5. Test market data
    const testSymbol = 'BTC-USD-PERP';
    console.log(`\n📈 Testing market data for ${testSymbol}...`);
    
    try {
      const price = await client.getPrice(testSymbol);
      console.log(`✅ Current price: $${price.toFixed(2)}`);

      const marketInfo = await client.getMarketInfo(testSymbol);
      if (marketInfo) {
        console.log(`   Min order size: ${marketInfo.order_size_increment} ${marketInfo.base_currency}`);
        console.log(`   Price tick: $${marketInfo.price_tick_size}`);
        console.log(`   Min notional: $${marketInfo.min_notional}`);
      }
    } catch (error: any) {
      console.log(`⚠️  Market ${testSymbol} not available (this is ok on testnet)`);
    }

    // 6. Test account balance
    console.log('\n💰 Testing account balance...');
    try {
      const balance = await client.getBalance();
      console.log(`✅ Account equity: $${balance.balance.toFixed(2)}`);
      console.log(`   Unrealized P&L: $${balance.unrealizedPnL.toFixed(2)}`);
    } catch (error: any) {
      console.log('⚠️  Could not fetch balance:', error.message);
      console.log('   (Make sure you have deposited funds on Paradex testnet)');
    }

    // 7. Test positions
    console.log('\n📊 Testing positions...');
    try {
      const positions = await client.getPositions();
      console.log(`✅ Open positions: ${positions.length}`);
      
      if (positions.length > 0) {
        console.log('\n   Current positions:');
        positions.forEach(pos => {
          console.log(`   - ${pos.market}: ${pos.side} ${pos.size} @ $${pos.entry_price}`);
          console.log(`     Unrealized P&L: $${pos.unrealized_pnl}`);
        });
      }
    } catch (error: any) {
      console.log('⚠️  Could not fetch positions:', error.message);
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Deposit test USDC to your Paradex testnet account');
    console.log('   2. Try placing a small test order');
    console.log('   3. Monitor your position in the dashboard');
    console.log('\n🔗 Useful links:');
    console.log('   - Paradex Testnet: https://app.testnet.paradex.trade');
    console.log('   - Your account:', `https://voyager.testnet.paradex.trade/contract/${address}`);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\n🔍 Troubleshooting:');
    console.error('   1. Check that PARADEX_PRIVATE_KEY is set in .env');
    console.error('   2. Verify the private key is valid Ethereum format (0x...)');
    console.error('   3. Check that PARADEX_ENVIRONMENT is set to testnet or prod');
    console.error('   4. Ensure you have internet connection');
    process.exit(1);
  }
}

// Run test
testParadexConnection()
  .then(() => {
    console.log('\n✨ Connection test complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });
