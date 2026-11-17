/* global afterEach */
// Desmonta todo lo renderizado en cada prueba. Sin esto, los intervalos de los componentes (p. ej. useBuziosToday,
// cada 60 s) siguen vivos y Jest no termina al ejecutar un archivo suelto ("worker failed to exit gracefully").
const ReactTestRenderer = require('react-test-renderer');

const mounted = [];
const originalCreate = ReactTestRenderer.create;
ReactTestRenderer.create = (...args) => {
  const renderer = originalCreate(...args);
  mounted.push(renderer);
  return renderer;
};

afterEach(() => {
  while (mounted.length) {
    const renderer = mounted.pop();
    try {
      ReactTestRenderer.act(() => renderer.unmount());
    } catch {
      // Ya desmontado por la propia prueba.
    }
  }
});
