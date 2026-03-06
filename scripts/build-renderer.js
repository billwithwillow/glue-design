const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['src/renderer/scripts/main.ts'],
    bundle: true,
    outfile: 'dist/renderer/scripts/main.js',
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: true,
    external: [],
    loader: {
      '.ts': 'ts',
    },
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching renderer for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Renderer build complete');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
