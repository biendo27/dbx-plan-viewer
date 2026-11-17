import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const bundle = await build({ entryPoints: ['src/app.js'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const html = await readFile('src/index.html', 'utf8');
const css = await readFile('src/style.css', 'utf8');
await mkdir('ui', {recursive: true});
await writeFile('ui/index.html', html.replace('/* STYLES */', css).replace('/* SCRIPT */', bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
console.log('DBX_UI_BUILD_SUCCESS');
