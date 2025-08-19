#!/usr/bin/env node

/**
 * Test Runner Script
 * 
 * This script runs all tests with proper configuration and reporting.
 * It can be used to run specific test suites or all tests.
 */

import { execSync } from 'child_process';
import path from 'path';

interface TestOptions {
  watch?: boolean;
  coverage?: boolean;
  verbose?: boolean;
  testPattern?: string;
  timeout?: number;
}

class TestRunner {
  private options: TestOptions;

  constructor(options: TestOptions = {}) {
    this.options = {
      watch: false,
      coverage: true,
      verbose: false,
      timeout: 30000,
      ...options
    };
  }

  private buildJestArgs(): string[] {
    const args: string[] = [];

    // Basic Jest configuration
    args.push('--detectOpenHandles');
    args.push('--forceExit');
    args.push(`--timeout=${this.options.timeout}`);

    // Coverage options
    if (this.options.coverage) {
      args.push('--coverage');
      args.push('--coverageReporters=text');
      args.push('--coverageReporters=lcov');
      args.push('--coverageReporters=html');
      args.push('--coverageDirectory=coverage');
    }

    // Watch mode
    if (this.options.watch) {
      args.push('--watch');
      args.push('--watchAll');
    }

    // Verbose output
    if (this.options.verbose) {
      args.push('--verbose');
    }

    // Test pattern
    if (this.options.testPattern) {
      args.push(`--testNamePattern=${this.options.testPattern}`);
    }

    return args;
  }

  private runCommand(command: string): void {
    try {
      console.log(`\n🚀 Running: ${command}\n`);
      execSync(command, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error) {
      console.error('\n❌ Test execution failed:', error);
      process.exit(1);
    }
  }

  public runAllTests(): void {
    console.log('🧪 Running all tests...\n');
    const args = this.buildJestArgs();
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public runUnitTests(): void {
    console.log('🧪 Running unit tests...\n');
    const args = this.buildJestArgs();
    args.push('--testPathPattern=src/tests/(?!integration)');
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public runIntegrationTests(): void {
    console.log('🧪 Running integration tests...\n');
    const args = this.buildJestArgs();
    args.push('--testPathPattern=src/tests/integration');
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public runRouteTests(): void {
    console.log('🧪 Running route tests...\n');
    const args = this.buildJestArgs();
    args.push('--testPathPattern=src/tests/routes');
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public runSpecificTest(testPath: string): void {
    console.log(`🧪 Running specific test: ${testPath}\n`);
    const args = this.buildJestArgs();
    args.push(testPath);
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public runWithPattern(pattern: string): void {
    console.log(`🧪 Running tests matching pattern: ${pattern}\n`);
    const args = this.buildJestArgs();
    args.push(`--testNamePattern=${pattern}`);
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);
  }

  public generateReport(): void {
    console.log('📊 Generating test report...\n');
    
    // Run tests with coverage
    const args = this.buildJestArgs();
    args.push('--coverage');
    args.push('--coverageReporters=html');
    args.push('--coverageReporters=json');
    args.push('--coverageReporters=text-summary');
    
    const command = `npx jest ${args.join(' ')}`;
    this.runCommand(command);

    console.log('\n✅ Test report generated successfully!');
    console.log('📁 Coverage report available at: coverage/index.html');
  }
}

// CLI interface
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  const options: TestOptions = {
    watch: args.includes('--watch'),
    coverage: !args.includes('--no-coverage'),
    verbose: args.includes('--verbose'),
    timeout: parseInt(args.find(arg => arg.startsWith('--timeout='))?.split('=')[1] || '30000')
  };

  const runner = new TestRunner(options);

  switch (command) {
    case 'all':
      runner.runAllTests();
      break;
    case 'unit':
      runner.runUnitTests();
      break;
    case 'integration':
      runner.runIntegrationTests();
      break;
    case 'routes':
      runner.runRouteTests();
      break;
    case 'report':
      runner.generateReport();
      break;
    case 'pattern':
      const pattern = args[1];
      if (!pattern) {
        console.error('❌ Pattern is required. Usage: npm run test:pattern <pattern>');
        process.exit(1);
      }
      runner.runWithPattern(pattern);
      break;
    case 'file':
      const testPath = args[1];
      if (!testPath) {
        console.error('❌ Test file path is required. Usage: npm run test:file <path>');
        process.exit(1);
      }
      runner.runSpecificTest(testPath);
      break;
    default:
      console.log(`
🧪 Test Runner - Available Commands:

  npm run test:all              - Run all tests with coverage
  npm run test:unit             - Run unit tests only
  npm run test:integration      - Run integration tests only
  npm run test:routes           - Run route tests only
  npm run test:report           - Generate detailed test report
  npm run test:pattern <pattern> - Run tests matching pattern
  npm run test:file <path>      - Run specific test file

Options:
  --watch                       - Run in watch mode
  --no-coverage                 - Disable coverage reporting
  --verbose                     - Enable verbose output
  --timeout=<ms>               - Set test timeout (default: 30000)

Examples:
  npm run test:all -- --watch
  npm run test:pattern "HMAC"
  npm run test:file src/tests/routes/hmacRoutes.test.ts
  npm run test:unit -- --verbose
      `);
      break;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

export { TestRunner };
