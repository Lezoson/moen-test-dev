module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  roots: ['<rootDir>/src'],
  moduleDirectories: ['node_modules', 'src'],
  transform: {
    '^.+\\.ts$': 'ts-jest', // Use ts-jest for .ts files
  },
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{js,ts}', '!src/**/*.d.ts', '!src/**/index.js'],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  testMatch: ['**/?(*.)+(spec|test).{js,ts}'], // Match .js and .ts files
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transformIgnorePatterns: ['/node_modules/'],
};
