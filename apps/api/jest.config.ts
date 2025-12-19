import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/(test|src)/**/*.spec.ts', '<rootDir>/(test|src)/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@wheelpath/validation$': '<rootDir>/../../packages/validation/src/index.ts',
    '^@wheelpath/schemas/(.*)$': '<rootDir>/../../packages/schemas/$1',
  },
};

export default config;
