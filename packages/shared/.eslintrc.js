module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@lynkbot/*'], message: 'packages/shared has zero internal deps — no @lynkbot/* imports allowed' },
        { group: ['../../../apps/*', '../../apps/*'], message: 'packages/shared cannot import from apps/' },
      ]
    }]
  }
};
