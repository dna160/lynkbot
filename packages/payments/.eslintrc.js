module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@lynkbot/db', '@lynkbot/ai', '@lynkbot/wati'], message: 'packages/payments can only import @lynkbot/shared' },
        { group: ['../../../apps/*'], message: 'packages/payments cannot import from apps/' }
      ]
    }]
  }
};
