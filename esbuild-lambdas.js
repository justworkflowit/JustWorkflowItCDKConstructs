// esbuild-lambdas.js (CommonJS version)
const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: ['src/lambda/definitionDeployerLambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/lambda/definitionDeployerLambda.js',
  external: ['aws-sdk'], // provided by Lambda runtime
}).catch(() => process.exit(1));
