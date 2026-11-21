import {mkdir,rm,cp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('.',import.meta.url)),out=root+'dist';
await rm(out,{recursive:true,force:true});await mkdir(out+'/assets',{recursive:true});
await cp(root+'src',out+'/assets',{recursive:true});
await cp(root+'../brandbook/onboarding/fonts',out+'/assets/fonts',{recursive:true});
await cp(root+'../brandbook/icons.js',out+'/assets/icons.js');
await cp(root+'../brandbook/onboarding/style.css',out+'/assets/auth.css');
await cp(root+'src/auth-layout.css',out+'/assets/auth-layout.css');
await cp(root+'../brandbook/onboarding/phone.js',out+'/assets/phone.js');
await cp(root+'../brandbook/onboarding/countries.js',out+'/assets/countries.js');
const enablePreview=process.env.SASHA_ENABLE_PREVIEW==='1';
const enableUiReview=enablePreview||(process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='design/web-ui-system-v2-20261121');
if(enablePreview)await cp(root+'../brandbook/onboarding/preview-api.js',out+'/assets/preview-api.js');
if(enableUiReview){await cp(root+'review/ui-review.html',out+'/ui-review.html');await cp(root+'review/ui-review.js',out+'/assets/ui-review.js');await cp(root+'review/ui-review.css',out+'/assets/ui-review.css');}
else await rm(out+'/assets/preview-api.js',{force:true});
await cp(root+'../assets/sashatel-symbol.svg',out+'/assets/sashatel-symbol.svg');
await cp(root+'../assets/sashatel-lock.svg',out+'/assets/lock.svg');
await cp(root+'../assets/sashatel-symbol-transparent.svg',out+'/assets/sashatel-symbol-transparent.svg');
let sha='unknown';try{sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
await writeFile(out+'/assets/config.js', 'window.__SASHA_PREVIEW_ENABLED__='+JSON.stringify(enablePreview)+';');
await writeFile(out+'/version.json',JSON.stringify({ui_sha:sha,backend_sha:'b682819a2417a7807dfdc881f641402f41af1d8b'}));
await writeFile(out+'/index.html','<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\'; media-src \'self\'; connect-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'"><title>SashaTel</title><link rel="icon" type="image/svg+xml" href="/assets/sashatel-symbol.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap"><link rel="stylesheet" href="/assets/auth.css"><link rel="stylesheet" href="/assets/auth-experience.css"><link rel="stylesheet" href="/assets/platform.css"><link rel="stylesheet" href="/assets/cabinet-ux.css"><link rel="stylesheet" href="/assets/cabinet-v3.css"><link rel="stylesheet" href="/assets/auth-layout.css"><script src="/assets/config.js"></script><script defer src="/assets/icons.js"></script><script type="module" src="/assets/main.js"></script></head><body><a class="skip" href="#content">К содержанию</a><header class="topbar"><a class="wordmark" href="/register/"><img src="/assets/sashatel-symbol.svg" width="32" height="32" alt="" aria-hidden="true">SashaTel</a></header><main id="content" tabindex="-1" aria-busy="true"></main></body></html>');
console.log('Built web/dist; same-origin /v1; UI '+sha);
