module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // @insforge/shared-schemas solo publica ESM (exports con la condición "import") y el SDK lo carga con
  // require(): Metro lo resuelve, Jest no. Se apunta a su entrada y Babel la transforma.
  moduleNameMapper: {
    '^@insforge/shared-schemas$': '<rootDir>/node_modules/@insforge/shared-schemas/dist/index.js',
  },
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@insforge)/)'],
};
