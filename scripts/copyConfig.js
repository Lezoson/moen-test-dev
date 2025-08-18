// scripts/copyConfig.js
const fs = require('fs');
const path = require('path');

const sourceFile = path.resolve(__dirname, '..', '.npmrc');
const distDir = path.resolve(__dirname, '..', 'dist');
const destFile = path.join(distDir, '.npmrc');

// Make sure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(sourceFile)) {
  fs.copyFileSync(sourceFile, destFile);
  console.log('✔ Copied .npmrc to dist folder.');
} else {
  console.warn('⚠ .npmrc file not found. Skipping copy.');
}
