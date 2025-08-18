#!/usr/bin/env node

/**
 * Event Grid Retry Testing Script
 *
 * This script demonstrates how to test different Event Grid retry scenarios.
 * Run it with: node test-eventgrid-retries.js
 */

const { eventGridTestUtils } = require('./dist/utils/eventGridTestUtils');

async function main() {
  console.log('🚀 Event Grid Retry Testing Script\n');

  try {
    // Run all retry scenario tests
    await eventGridTestUtils.constructor.testRetryScenarios();

    console.log('\n🎯 Manual Testing Options:');
    console.log('1. Test specific failure rate:');
    console.log(
      '   eventGridTestUtils.configure({ failureRate: 0.5, simulateError: "processing" });',
    );

    console.log('\n2. Test specific event type failures:');
    console.log('   eventGridTestUtils.configure({ failEventTypes: ["PageProof.ProofCreated"] });');

    console.log('\n3. Test timeout scenarios:');
    console.log(
      '   eventGridTestUtils.configure({ simulateError: "timeout", simulateDelay: 5000 });',
    );

    console.log('\n4. Reset and test clean:');
    console.log('   eventGridTestUtils.resetCounters();');

    console.log('\n5. Check current stats:');
    console.log('   const stats = eventGridTestUtils.getStats();');
    console.log('   console.log(stats);');
  } catch (error) {
    console.error('❌ Test script failed:', error.message);
    process.exit(1);
  }
}

// Run the main function
if (require.main === module) {
  main();
}

module.exports = { main };
