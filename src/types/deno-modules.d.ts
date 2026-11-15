// Módulos que solo existen en Deno (InsForge Functions). functions/offer-media.ts los importa en el despliegue; aquí
// se declaran para que tsc del proyecto lo compruebe sin resolverlos. En Deno se usan los tipos reales.
declare module 'npm:@insforge/sdk@1.5.2' {
  export const createClient: unknown;
}
