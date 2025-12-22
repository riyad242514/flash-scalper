/**
 * End-to-End Test Script for Artifact Collection
 * Tests artifact collection, GCP upload, and public URL generation
 */

import { ArtifactManager } from './src/services/artifacts/artifact-manager';
import { loadArtifactConfig } from './src/config';
import { loadScalperConfig } from './src/config';
import type { AgentState, Position } from './src/types';
import * as fs from 'fs/promises';
import * as path from 'path';

async function testArtifactCollection() {
  console.log('🧪 Testing Artifact Collection End-to-End\n');

  // Load config
  const artifactConfig = loadArtifactConfig();
  const scalperConfig = loadScalperConfig();

  if (!artifactConfig.enabled) {
    console.log('❌ Artifact collection is disabled in .env');
    console.log('   Set ARTIFACT_COLLECTION_ENABLED=true\n');
    return;
  }

  console.log('✅ Artifact collection enabled');
  console.log(`   Base dir: ${artifactConfig.baseDir}`);
  console.log(`   Version: ${artifactConfig.version}`);
  console.log(`   Run rotation: ${artifactConfig.runRotationEnabled ? `Enabled (every ${artifactConfig.runRotationIntervalHours}h)` : 'Disabled'}`);

  if (artifactConfig.cloudStorage) {
    console.log(`\n✅ GCP Storage configured`);
    console.log(`   Bucket: ${artifactConfig.cloudStorage.bucket}`);
    console.log(`   Project: ${artifactConfig.cloudStorage.projectId}`);
    console.log(`   Public URL: ${artifactConfig.cloudStorage.publicUrlBase}`);
  } else {
    console.log('\n⚠️  GCP Storage not configured');
    console.log('   Artifacts will be saved locally only');
  }

  // Create test log file
  const testLogPath = '/tmp/scalper-live-test.log';
  await fs.writeFile(testLogPath, `[TEST] Test log entry at ${new Date().toISOString()}\n`, 'utf-8');
  console.log(`\n📝 Created test log: ${testLogPath}`);

  // Initialize artifact manager
  const manager = new ArtifactManager({
    ...artifactConfig,
    logFile: testLogPath,
  });

  const testRunId = `test-run-${Date.now()}`;
  const version = artifactConfig.version;

  console.log(`\n🚀 Initializing test run: ${testRunId}`);

  try {
    // 1. Initialize run
    const artifacts = await manager.initializeRun(testRunId, version);
    console.log(`✅ Run initialized: ${artifacts.runPath}`);

    // 2. Collect config
    const configResult = await manager.collectConfig(testRunId, scalperConfig, version);
    if (configResult.snapshotFile) {
      console.log(`✅ Config collected: ${configResult.snapshotFile}`);
      const configContent = await fs.readFile(configResult.snapshotFile, 'utf-8');
      const configJson = JSON.parse(configContent);
      console.log(`   Config version: ${configJson.version}`);
      console.log(`   Config keys: ${Object.keys(configJson.config).length} parameters`);
    }

    // 3. Collect logs
    const logResult = await manager.collectLogs(testRunId);
    if (logResult) {
      console.log(`✅ Logs collected: ${logResult}`);
      const logContent = await fs.readFile(logResult, 'utf-8');
      console.log(`   Log size: ${logContent.length} bytes`);
    }

    // 4. Create mock state and positions for P&L
    const mockState: AgentState = {
      agentId: testRunId,
      userId: 'test-user',
      status: 'running',
      config: scalperConfig,
      positions: new Map(),
      equity: 1000,
      startingEquity: 1000,
      dailyStartEquity: 1000,
      dailyPnL: 15.50,
      totalPnL: 15.50,
      totalTrades: 5,
      winningTrades: 3,
      lastTradeTime: Date.now(),
      lastTickTime: Date.now(),
      tickCount: 100,
      lastScanTick: 50,
      lastSyncTick: 50,
    };

    const mockPositions = new Map<string, Position>();
    mockPositions.set('BTCUSDT', {
      id: 'pos-1',
      agentId: testRunId,
      symbol: 'BTCUSDT',
      side: 'long',
      size: 0.1,
      entryPrice: 50000,
      currentPrice: 51000,
      leverage: 10,
      marginUsed: 500,
      unrealizedPnl: 100,
      unrealizedROE: 20,
      highestROE: 20,
      lowestROE: -5,
      openedAt: Date.now() - 60000,
      updatedAt: Date.now(),
    });

    // 5. Collect P&L snapshot
    const pnlResult = await manager.collectPnLSnapshot(testRunId, mockState, mockPositions);
    if (pnlResult.summaryFile) {
      console.log(`✅ P&L summary collected: ${pnlResult.summaryFile}`);
      const pnlContent = await fs.readFile(pnlResult.summaryFile, 'utf-8');
      const pnlJson = JSON.parse(pnlContent);
      console.log(`   Equity: $${pnlJson.equity}`);
      console.log(`   Daily P&L: $${pnlJson.dailyPnL}`);
      console.log(`   Win rate: ${pnlJson.winRate.toFixed(1)}%`);
    }
    if (pnlResult.tradesFile) {
      console.log(`✅ Trades list collected: ${pnlResult.tradesFile}`);
      const tradesContent = await fs.readFile(pnlResult.tradesFile, 'utf-8');
      const trades = JSON.parse(tradesContent);
      console.log(`   Trades: ${trades.length}`);
    }

    // 6. Finalize run (uploads to GCP if configured)
    console.log(`\n📤 Finalizing run and uploading to GCP...`);
    const finalArtifacts = await manager.finalizeRun(testRunId);

    if (finalArtifacts.cloudUrls && Object.keys(finalArtifacts.cloudUrls).length > 0) {
      console.log(`\n✅ Artifacts uploaded to GCP!`);
      console.log(`   Uploaded files: ${Object.keys(finalArtifacts.cloudUrls).length}`);
      console.log(`\n📋 Public URLs:`);
      for (const [file, url] of Object.entries(finalArtifacts.cloudUrls)) {
        console.log(`   ${file}: ${url}`);
      }
    } else if (artifactConfig.cloudStorage) {
      console.log(`\n⚠️  No artifacts uploaded (check GCP credentials and bucket permissions)`);
    } else {
      console.log(`\n✅ Artifacts saved locally (GCP not configured)`);
    }

    // 7. Verify local files
    console.log(`\n📁 Local artifact structure:`);
    if (artifacts.runPath) {
      const files = await fs.readdir(artifacts.runPath, { recursive: true });
      for (const file of files) {
        const filePath = path.join(artifacts.runPath, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          console.log(`   ${file} (${stats.size} bytes)`);
        }
      }
    }

    console.log(`\n✅ End-to-end test complete!`);
    console.log(`\n📂 Artifacts location: ${artifacts.runPath}`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Check artifacts folder: ls -la ${artifacts.runPath}`);
    if (artifactConfig.cloudStorage) {
      console.log(`   2. Check GCP bucket: gcloud storage ls gs://${artifactConfig.cloudStorage.bucket}/`);
      console.log(`   3. Test public URLs in browser`);
    }
    console.log(`   4. Run scalper: npm run start:scalper`);

  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    manager.cleanup();
  }
}

// Run test
testArtifactCollection().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

