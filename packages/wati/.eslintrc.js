module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@lynkbot/db', '@lynkbot/ai', '@lynkbot/payments'], message: 'packages/wati can only import @lynkbot/shared' },
        { group: ['../../../apps/*'], message: 'packages/wati cannot import from apps/' }
      ]
    }]
  }
};
