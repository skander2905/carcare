/**
 * Conventional Commits, enforced by a commit-msg hook.
 * Examples: `feat: add fuel consumption engine`, `fix: reject odometer regressions`.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'users',
        'vehicles',
        'fuel',
        'expenses',
        'maintenance',
        'reminders',
        'documents',
        'trips',
        'analytics',
        'notifications',
        'jobs',
        'common',
        'db',
        'api',
        'web',
        'infra',
        'ci',
        'docs',
        'deps',
      ],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'body-max-line-length': [1, 'always', 120],
  },
};
