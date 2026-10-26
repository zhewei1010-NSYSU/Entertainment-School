import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Do not delete old hashed assets: existing tabs may still use them.
cpSync(root+'dist/assets',root+'assets',{recursive:true});
cpSync(root+'dist/index.html',root+'index.html');
console.log('Updated root site and PWA resources. Commit these alongside source changes.');

// Keep PWA resources beside the deployed HTML; retain old assets for open clients.
for (const name of ['manifest.webmanifest','sw.js','apple-touch-icon.png','pwa-192.png','pwa-512.png']) cpSync(root+'dist/'+name,root+name);
import { readdirSync } from 'node:fs';
for (const name of readdirSync(root+'dist')) if (/^workbox-.*\.js$/.test(name)) cpSync(root+'dist/'+name,root+name);
