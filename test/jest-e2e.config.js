/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: '\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 20000,
};
