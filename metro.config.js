// `@teleforge/core` is a path-aliased internal package (not a node_modules
// dependency), so map the bare specifier to its source. It lives under the
// project root, so Metro already watches and transforms it.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@teleforge/core': path.resolve(__dirname, 'packages/core/src'),
};

module.exports = config;
