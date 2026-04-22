module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['whatsapp-web.js'], message: 'Unofficial WA library — compliance violation. Use WATI API only.' },
        { group: ['@whiskeysockets/baileys'], message: 'Unofficial WA library — compliance violation.' },
        { group: ['baileys'], message: 'Unofficial WA library — compliance violation.' },
        { group: ['wablas'], message: 'Unofficial WA library — compliance violation.' },
        { group: ['fonnte'], message: 'Unofficial WA library — compliance violation.' },
      ]
    }]
  }
};
