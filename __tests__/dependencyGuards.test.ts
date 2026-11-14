// Mitigación de GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6, agotamiento de memoria al validar colecciones
// enormes). zod@3 llega solo como dependencia de @insforge/shared-schemas, sin versión 3.x corregida.
// El SDK lo usa para constantes, no para validar datos del usuario; mientras la app tampoco lo
// importe, el vector no es alcanzable. Si esta prueba falla, revisar la advisory antes de seguir.
declare const __dirname: string;
const fs: {
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
  readFileSync(path: string, encoding: 'utf8'): string;
} = require('fs');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.(ts|tsx|js)$/.test(entry.name) ? [`${dir}/${entry.name}`] : [],
  );
}

it('keeps app code from importing zod or the InsForge shared schemas directly', () => {
  const root = `${__dirname}/..`;
  const files = [...sourceFiles(`${root}/src`), `${root}/App.tsx`, `${root}/index.js`];
  expect(files.length).toBeGreaterThan(20);
  const offenders = files.filter(file =>
    /from\s+['"](zod|@insforge\/shared-schemas)['"]|require\(\s*['"](zod|@insforge\/shared-schemas)['"]\s*\)/
      .test(fs.readFileSync(file, 'utf8')),
  );
  expect(offenders).toEqual([]);
});
