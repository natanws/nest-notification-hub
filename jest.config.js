/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts'],
  coverageDirectory: '../coverage',
};
