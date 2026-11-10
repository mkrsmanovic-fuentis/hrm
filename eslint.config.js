// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * UI libraries the app must not use. All UI comes from @specora-dev/ui-kit.
 * If ui-kit lacks a component, report the gap instead of adding a library.
 */
const forbiddenUiLibraries = [
  '@angular/material',
  '@angular/material/*',
  '@angular/material-*',
  'primeng',
  'primeng/*',
  '@ng-bootstrap/*',
  'ngx-bootstrap',
  'ngx-bootstrap/*',
  '@taiga-ui/*',
  'ng-zorro-antd',
  'ng-zorro-antd/*',
  '@clr/*',
  '@ionic/angular',
  '@ionic/angular/*',
  '@nebular/*',
  '@coreui/*',
  '@syncfusion/*',
  '@progress/kendo-*',
  'devextreme-angular',
  'devextreme-angular/*',
  'bootstrap',
  'bootstrap/*',
];

const uiLibraryRule = {
  group: forbiddenUiLibraries,
  message:
    'Use @specora-dev/ui-kit for all UI. If a component is missing, report the gap to the lead instead of adding another UI library.',
};

const httpClientRule = {
  group: ['@angular/common/http'],
  message:
    'Call the API through ApiClient from core/api. Components never use HttpClient directly.',
};

module.exports = defineConfig([
  {
    // Generated from the OpenAPI spec by `pnpm api:types`. Never edit by hand.
    ignores: ['src/**/*.gen.ts'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      // Conventions shared with ui-kit: standalone, OnPush, signal APIs.
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-inject': 'error',
      'no-restricted-imports': ['error', { patterns: [uiLibraryRule] }],
    },
  },
  {
    // Features and shared code reach the API only through ApiClient (src/app/core/api).
    files: ['src/app/features/**/*.ts', 'src/app/shared/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [uiLibraryRule, httpClientRule] }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
