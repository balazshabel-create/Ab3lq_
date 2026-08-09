const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// A tsconfig `paths` (`@/*`) feloldása Metro szinten.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
