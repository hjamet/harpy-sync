import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');

const outdir = join(__dirname, 'dist');

// Ensure output directories exist
function ensureDirs() {
  const dirs = [
    outdir,
    join(outdir, 'background'),
    join(outdir, 'content'),
    join(outdir, 'injected'),
    join(outdir, 'popup'),
    join(outdir, 'icons')
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// Copy static assets
function copyStaticAssets() {
  ensureDirs();
  
  // Copy manifest
  copyFileSync(join(__dirname, 'manifest.json'), join(outdir, 'manifest.json'));
  
  // Copy popup HTML & CSS if they exist
  const popupHtml = join(__dirname, 'src', 'popup', 'popup.html');
  const popupCss = join(__dirname, 'src', 'popup', 'popup.css');
  if (existsSync(popupHtml)) {
    copyFileSync(popupHtml, join(outdir, 'popup', 'popup.html'));
  }
  if (existsSync(popupCss)) {
    copyFileSync(popupCss, join(outdir, 'popup', 'popup.css'));
  }

  // Copy icons if they exist
  const iconsDir = join(__dirname, 'icons');
  if (existsSync(iconsDir)) {
    const iconFiles = ['icon16.png', 'icon48.png', 'icon128.png'];
    for (const file of iconFiles) {
      const src = join(iconsDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(outdir, 'icons', file));
      }
    }
  }
}

const buildOptions = [
  // Background Service Worker
  {
    entryPoints: [join(__dirname, 'src', 'background', 'service-worker.ts')],
    outfile: join(outdir, 'service-worker.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
  },
  // Content Script
  {
    entryPoints: [join(__dirname, 'src', 'content', 'index.ts')],
    outfile: join(outdir, 'content', 'content.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
  },
  // Injected Main World Bridge
  {
    entryPoints: [join(__dirname, 'src', 'injected', 'main-world-bridge.ts')],
    outfile: join(outdir, 'injected', 'main-world-bridge.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
  },
  // Popup Script
  {
    entryPoints: [join(__dirname, 'src', 'popup', 'popup.ts')],
    outfile: join(outdir, 'popup', 'popup.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
  }
];

async function runBuild() {
  copyStaticAssets();
  console.log('⚡ Building @harpy/chrome-extension...');

  if (isWatch) {
    const contexts = await Promise.all(
      buildOptions.map(opt => esbuild.context(opt))
    );
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('👀 Watching for changes...');
  } else {
    await Promise.all(
      buildOptions.map(opt => esbuild.build(opt))
    );
    console.log('✅ Extension build completed successfully!');
  }
}

runBuild().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
