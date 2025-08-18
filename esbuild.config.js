const esbuild = require('esbuild');
const { copy } = require('esbuild-plugin-copy');

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
      plugins: [
        // Copy static files if needed
        copy({
          assets: {
            from: ['./public/*'],
            to: ['./dist/public']
          }
        })
      ],
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      },
      banner: {
        js: '#!/usr/bin/env node'
      }
    });
    
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
