// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// @supabase/supabase-js v2 ships an .mjs build that uses:
//   import(/* webpackIgnore */ OTEL_PKG)   ← dynamic import with variable
// Hermes can't compile that. The .cjs build uses require(s) instead, which
// is fine. Force Metro to resolve @supabase/supabase-js to the .cjs build.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@supabase/supabase-js') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'node_modules/@supabase/supabase-js/dist/index.cjs'),
    };
  }
  // Stub @opentelemetry/api — referenced by the .cjs build via require(s).
  // Resolving to empty prevents a missing-module error at bundle time.
  if (moduleName === '@opentelemetry/api') {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
