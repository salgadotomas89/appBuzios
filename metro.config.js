const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Módulos de Node que no existen en React Native. @insforge/sdk hace un
// `import("crypto")` que solo se ejecuta en Node; en la app se resuelve vacío.
const NODE_ONLY_MODULES = new Set(['crypto']);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (NODE_ONLY_MODULES.has(moduleName)) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
