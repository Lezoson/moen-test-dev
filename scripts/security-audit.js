#!/usr/bin/env node

/**
 * Security Audit Script
 *
 * This script performs various security checks on the codebase:
 * - Dependency vulnerability scanning
 * - Code security analysis
 * - Configuration validation
 * - Best practices verification
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// Security check results
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  issues: [],
};

// Helper functions
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}`);
}

function logPass(message) {
  log(`✓ ${message}`, 'green');
  results.passed++;
}

function logFail(message, details = '') {
  log(`✗ ${message}`, 'red');
  if (details) log(`  ${details}`, 'red');
  results.failed++;
  results.issues.push({ type: 'error', message, details });
}

function logWarning(message, details = '') {
  log(`⚠ ${message}`, 'yellow');
  if (details) log(`  ${details}`, 'yellow');
  results.warnings++;
  results.issues.push({ type: 'warning', message, details });
}

// Security checks
function checkDependencies() {
  logSection('Dependency Security Check');

  try {
    // Check if package-lock.json exists
    if (!fs.existsSync('package-lock.json')) {
      logFail('package-lock.json not found', 'Run npm install to generate it');
      return;
    }

    // Run npm audit
    try {
      const auditOutput = execSync('npm audit --audit-level=moderate --json', { encoding: 'utf8' });
      const auditData = JSON.parse(auditOutput);

      if (auditData.metadata && auditData.metadata.vulnerabilities) {
        const vulns = auditData.metadata.vulnerabilities;
        const totalVulns = Object.values(vulns).reduce((sum, count) => sum + count, 0);

        if (totalVulns === 0) {
          logPass('No vulnerabilities found in dependencies');
        } else {
          logFail(
            `${totalVulns} vulnerabilities found`,
            `Critical: ${vulns.critical || 0}, High: ${vulns.high || 0}, Moderate: ${vulns.moderate || 0}, Low: ${vulns.low || 0}`,
          );

          // Log specific vulnerabilities
          if (auditData.advisories) {
            Object.values(auditData.advisories).forEach(advisory => {
              logWarning(
                `Vulnerability: ${advisory.title}`,
                `Severity: ${advisory.severity}, Module: ${advisory.module_name}`,
              );
            });
          }
        }
      }
    } catch (error) {
      logWarning('npm audit failed', error.message);
    }
  } catch (error) {
    logFail('Dependency check failed', error.message);
  }
}

function checkEnvironmentVariables() {
  logSection('Environment Variables Check');

  const requiredVars = ['NODE_ENV', 'AZURE_KEYVAULTURL', 'HMAC_SECRET', 'COOKIE_SECRET'];

  const optionalVars = [
    'LOG_LEVEL',
    'RATE_LIMIT_STANDARD',
    'RATE_LIMIT_STRICT',
    'MAX_FILE_SIZE',
    'ALLOWED_ORIGINS',
  ];

  // Check required variables
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      logFail(`Required environment variable missing: ${varName}`);
    } else {
      logPass(`Environment variable set: ${varName}`);
    }
  });

  // Check optional variables
  optionalVars.forEach(varName => {
    if (!process.env[varName]) {
      logWarning(`Optional environment variable not set: ${varName}`);
    } else {
      logPass(`Environment variable set: ${varName}`);
    }
  });

  // Check for sensitive variables in code
  const sensitivePatterns = [
    /password\s*[:=]\s*['"][^'"]+['"]/gi,
    /secret\s*[:=]\s*['"][^'"]+['"]/gi,
    /key\s*[:=]\s*['"][^'"]+['"]/gi,
    /token\s*[:=]\s*['"][^'"]+['"]/gi,
  ];

  const sourceFiles = findSourceFiles();
  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    sensitivePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        logWarning(
          `Potential hardcoded secret in ${file}`,
          `Found: ${matches[0].substring(0, 50)}...`,
        );
      }
    });
  });
}

function checkFilePermissions() {
  logSection('File Permissions Check');

  const criticalFiles = [
    'package.json',
    'package-lock.json',
    '.env',
    '.env.local',
    '.env.production',
  ];

  criticalFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      const mode = stats.mode.toString(8);

      // Check if file is readable by others
      if (mode.endsWith('6') || mode.endsWith('7')) {
        logWarning(`File permissions too permissive: ${file}`, `Mode: ${mode}`);
      } else {
        logPass(`File permissions OK: ${file}`);
      }
    }
  });
}

function checkCodeSecurity() {
  logSection('Code Security Analysis');

  const sourceFiles = findSourceFiles();
  const securityIssues = [];

  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');

    // Check for dangerous patterns
    const dangerousPatterns = [
      {
        pattern: /eval\s*\(/gi,
        description: 'eval() usage detected',
        severity: 'high',
      },
      {
        pattern: /setTimeout\s*\(\s*['"`][^'"`]*['"`]/gi,
        description: 'Dynamic setTimeout with string',
        severity: 'medium',
      },
      {
        pattern: /setInterval\s*\(\s*['"`][^'"`]*['"`]/gi,
        description: 'Dynamic setInterval with string',
        severity: 'medium',
      },
      {
        pattern: /new\s+Function\s*\(/gi,
        description: 'Dynamic function creation',
        severity: 'high',
      },
      {
        pattern: /innerHTML\s*=/gi,
        description: 'innerHTML assignment',
        severity: 'medium',
      },
      {
        pattern: /document\.write\s*\(/gi,
        description: 'document.write usage',
        severity: 'medium',
      },
    ];

    dangerousPatterns.forEach(({ pattern, description, severity }) => {
      const matches = content.match(pattern);
      if (matches) {
        securityIssues.push({
          file,
          description,
          severity,
          count: matches.length,
        });
      }
    });
  });

  if (securityIssues.length === 0) {
    logPass('No obvious security issues found in code');
  } else {
    securityIssues.forEach(issue => {
      if (issue.severity === 'high') {
        logFail(`${issue.description} in ${issue.file}`, `Found ${issue.count} occurrence(s)`);
      } else {
        logWarning(`${issue.description} in ${issue.file}`, `Found ${issue.count} occurrence(s)`);
      }
    });
  }
}

function checkConfiguration() {
  logSection('Configuration Security Check');

  // Check TypeScript configuration
  if (fs.existsSync('tsconfig.json')) {
    const tsConfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));

    if (tsConfig.compilerOptions?.strict !== true) {
      logWarning(
        'TypeScript strict mode not enabled',
        'Consider enabling strict mode for better type safety',
      );
    } else {
      logPass('TypeScript strict mode enabled');
    }

    if (tsConfig.compilerOptions?.noImplicitAny !== true) {
      logWarning(
        'TypeScript noImplicitAny not enabled',
        'Consider enabling for better type safety',
      );
    } else {
      logPass('TypeScript noImplicitAny enabled');
    }
  }

  // Check ESLint configuration
  if (fs.existsSync('eslint.config.mjs')) {
    logPass('ESLint configuration found');
  } else {
    logWarning('ESLint configuration not found', 'Consider adding ESLint for code quality');
  }

  // Check for security-related scripts in package.json
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = packageJson.scripts || {};

  if (scripts.audit) {
    logPass('Security audit script found in package.json');
  } else {
    logWarning(
      'No security audit script in package.json',
      'Consider adding: "audit": "npm audit && node scripts/security-audit.js"',
    );
  }
}

function checkBestPractices() {
  logSection('Security Best Practices Check');

  // Check for HTTPS usage
  const sourceFiles = findSourceFiles();
  let hasHttpUrl = false;

  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('http://') && !content.includes('localhost')) {
      hasHttpUrl = true;
      logWarning(`HTTP URL found in ${file}`, 'Consider using HTTPS for production');
    }
  });

  if (!hasHttpUrl) {
    logPass('No HTTP URLs found in code');
  }

  // Check for console.log usage in production code
  let hasConsoleLog = false;
  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('console.log(') && !file.includes('.test.') && !file.includes('.spec.')) {
      hasConsoleLog = true;
      logWarning(`console.log found in ${file}`, 'Consider using proper logging library');
    }
  });

  if (!hasConsoleLog) {
    logPass('No console.log statements found in production code');
  }

  // Check for proper error handling
  let hasTryCatch = false;
  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('try {') && content.includes('} catch')) {
      hasTryCatch = true;
    }
  });

  if (hasTryCatch) {
    logPass('Error handling patterns found in code');
  } else {
    logWarning(
      'No error handling patterns found',
      'Consider adding try-catch blocks for better error handling',
    );
  }
}

// Helper function to find source files
function findSourceFiles() {
  const files = [];

  function walkDir(dir) {
    const items = fs.readdirSync(dir);

    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (
        stat.isDirectory() &&
        !item.startsWith('.') &&
        item !== 'node_modules' &&
        item !== 'dist'
      ) {
        walkDir(fullPath);
      } else if (stat.isFile() && /\.(js|ts|jsx|tsx)$/.test(item)) {
        files.push(fullPath);
      }
    });
  }

  walkDir('.');
  return files;
}

// Generate report
function generateReport() {
  logSection('Security Audit Report');

  log(`\n${colors.bold}Summary:${colors.reset}`);
  log(`  Passed: ${results.passed}`, 'green');
  log(`  Failed: ${results.failed}`, 'red');
  log(`  Warnings: ${results.warnings}`, 'yellow');

  if (results.issues.length > 0) {
    log(`\n${colors.bold}Issues Found:${colors.reset}`);
    results.issues.forEach((issue, index) => {
      const color = issue.type === 'error' ? 'red' : 'yellow';
      log(`  ${index + 1}. ${issue.message}`, color);
      if (issue.details) {
        log(`     ${issue.details}`, color);
      }
    });
  }

  // Overall assessment
  if (results.failed === 0 && results.warnings === 0) {
    log(`\n${colors.bold}${colors.green}🎉 Security audit passed!${colors.reset}`);
  } else if (results.failed === 0) {
    log(`\n${colors.bold}${colors.yellow}⚠️  Security audit passed with warnings${colors.reset}`);
  } else {
    log(`\n${colors.bold}${colors.red}❌ Security audit failed${colors.reset}`);
    process.exit(1);
  }
}

// Main execution
function main() {
  log(`${colors.bold}${colors.blue}🔒 Security Audit Tool${colors.reset}\n`);

  try {
    checkDependencies();
    checkEnvironmentVariables();
    checkFilePermissions();
    checkCodeSecurity();
    checkConfiguration();
    checkBestPractices();
    generateReport();
  } catch (error) {
    logFail('Security audit failed', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  checkDependencies,
  checkEnvironmentVariables,
  checkFilePermissions,
  checkCodeSecurity,
  checkConfiguration,
  checkBestPractices,
  generateReport,
};
