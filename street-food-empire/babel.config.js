module.exports = function (api) {
  api.cache(true);
  // A `@/*` alias a tsconfig.json `paths` mezőjéből jön: a Metro (Expo SDK 50+)
  // alapértelmezésben feloldja, a Jest pedig a jest.config.js moduleNameMapper-én
  // keresztül. Így nincs szükség külön babel-plugin-module-resolver függőségre.
  return {
    presets: ['babel-preset-expo'],
  };
};
