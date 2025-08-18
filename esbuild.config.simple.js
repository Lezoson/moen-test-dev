const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Simple function to copy files recursively
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Production build
async function build() {
  try {
    await esbuild.build({
      entryPoints: [
        'src/app.ts',
        'bin/www.ts'
      ],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outdir: 'dist',
      format: 'cjs',
      sourcemap: true,
      minify: process.env.NODE_ENV === 'production',
      external: [
        // External dependencies that shouldn't be bundled
        'express',
        'cors',
        'helmet',
        'compression',
        'morgan',
        'cookie-parser',
        'http-errors',
        'winston',
        'winston-daily-rotate-file',
        'axios',
        'zod',
        'busboy',
        'archiver',
        'yazl',
        'base64-stream',
        'async-mutex',
        'dotenv',
        'express-rate-limit',
        'globals',
        '@azure/identity',
        '@azure/keyvault-secrets',
        '@pageproof/sdk'
      ],
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      },
      banner: {
        js: '#!/usr/bin/env node'
      }
    });
    
    // Copy static files if they exist
    if (fs.existsSync('./public')) {
      copyDir('./public', './dist/public');
      console.log('📁 Copied public files');
    }
    
    console.log('✅ Build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Development build with watch mode
async function buildDev() {
  const context = await esbuild.context({
    entryPoints: [
      'src/app.ts',
      'bin/www.ts'
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outdir: 'dist',
    format: 'cjs',
    sourcemap: true,
    external: [
      'express',
      'cors',
      'helmet',
      'compression',
      'morgan',
      'cookie-parser',
      'http-errors',
      'winston',
      'winston-daily-rotate-file',
      'axios',
      'zod',
      'busboy',
      'archiver',
      'yazl',
      'base64-stream',
      'async-mutex',
      'dotenv',
      'express-rate-limit',
      'globals',
      '@azure/identity',
      '@azure/keyvault-secrets',
      '@pageproof/sdk'
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development')
    },
    banner: {
      js: '#!/usr/bin/env node'
    }
  });

  await context.watch();
  console.log('👀 Watching for changes...');
}

// Run based on command line arguments
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  buildDev();
} else {
  build();
}
