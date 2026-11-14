export {};

// Contrato frontend ↔ PostgreSQL: cada callRpc / database.rpc de los servicios debe nombrar una
// función que exista en supabase/migrations y pasar exactamente parámetros que esa función declara,
// incluidos todos los que no tienen valor por defecto. La última definición de cada función manda.
declare const __dirname: string;
const fs: { readdirSync(path: string): string[]; readFileSync(path: string, encoding: 'utf8'): string } = require('fs');

type Signature = { params: string[]; required: string[] };

function sqlSignatures(): Map<string, Signature> {
  const dir = `${__dirname}/../supabase/migrations`;
  const signatures = new Map<string, Signature>();
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(`${dir}/${file}`, 'utf8');
    for (const match of sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)) {
      const params = match[2].split(',').map(part => part.trim()).filter(Boolean);
      signatures.set(match[1], {
        params: params.map(part => part.split(/\s+/)[0]),
        required: params.filter(part => !/\bdefault\b/i.test(part)).map(part => part.split(/\s+/)[0]),
      });
    }
  }
  return signatures;
}

function rpcCalls(source: string): Array<{ name: string; keys: string[] }> {
  const calls: Array<{ name: string; keys: string[] }> = [];
  for (const match of source.matchAll(/(?:callRpc(?:<[^>]*>)?|\.rpc)\(\s*'(\w+)',\s*\{([^}]*)\}/g)) {
    const keys = [...match[2].matchAll(/(p_\w+)\s*:/g)].map(key => key[1]);
    calls.push({ name: match[1], keys });
  }
  return calls;
}

it('matches every RPC call in the services to a migrated function signature', () => {
  const signatures = sqlSignatures();
  const services = ['reservationService.ts', 'platformService.ts'].map(file =>
    fs.readFileSync(`${__dirname}/../src/lib/${file}`, 'utf8'));
  const calls = services.flatMap(rpcCalls);
  expect(calls.length).toBeGreaterThan(30);
  const problems: string[] = [];
  for (const call of calls) {
    const signature = signatures.get(call.name);
    if (!signature) {
      problems.push(`${call.name}: no such function in migrations`);
      continue;
    }
    const unknown = call.keys.filter(key => !signature.params.includes(key));
    const missing = signature.required.filter(param => !call.keys.includes(param));
    if (unknown.length) problems.push(`${call.name}: unknown ${unknown.join(', ')}`);
    if (missing.length) problems.push(`${call.name}: missing ${missing.join(', ')}`);
  }
  expect(problems).toEqual([]);
});
