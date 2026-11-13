import { build } from 'esbuild';
await build({
  entryPoints: ['frontend/components.js'],
  outfile: 'public/ui.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  legalComments: 'inline',
});

await build({entryPoints:['bridge/cli.mjs'],outfile:'public/joincraft-bridge.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['bufferutil','utf-8-validate'],legalComments:'inline'});
await build({entryPoints:['frontend/voice-sdk.js'],outfile:'public/voice-sdk.js',bundle:true,minify:true,format:'esm',target:['es2022'],legalComments:'inline'});
