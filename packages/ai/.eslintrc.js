module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@lynkbot/wati'], message: 'packages/ai cannot import @lynkbot/wati' },
        { group: ['@lynkbot/payments'], message: 'packages/ai cannot import @lynkbot/payments' },
        { group: ['../../../apps/*'], message: 'packages/ai cannot import from apps/' }
      ]
    }]
  }
};
