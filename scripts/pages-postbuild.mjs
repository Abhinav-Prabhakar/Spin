import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// GitHub Pages serves 404.html for unknown paths, so a room link like
// /Spin/r/ABC123 lands on the app instead of a dead end.
const docs = path.resolve('docs');
await copyFile(path.join(docs, 'index.html'), path.join(docs, '404.html'));
await writeFile(path.join(docs, '.nojekyll'), '');
console.log('pages: wrote 404.html and .nojekyll');
