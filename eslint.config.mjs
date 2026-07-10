import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'release/**',
      'resources/mcp/**',
      'resources/whisper/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Standalone MV3 extension: plain browser JS with the chrome.* API.
    files: ['browser-extension/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        EventSource: 'readonly',
        MediaRecorder: 'readonly',
        AudioContext: 'readonly',
        OfflineAudioContext: 'readonly',
        DataView: 'readonly',
        ArrayBuffer: 'readonly',
        NodeFilter: 'readonly',
        getSelection: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    }
  }
);
