import {mkdir,rm,cp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('.',import.meta.url)),out=root+'dist';
await rm(out,{recursive:true,force:true});await mkdir(out+'/assets',{recursive:true});
await cp(root+'src',out+'/assets',{recursive:true});
await cp(root+'../brandbook/onboarding/fonts',out+'/assets/fonts',{recursive:true});
await cp(root+'../brandbook/icons.js',out+'/assets/icons.js');
await cp(root+'../brandbook/onboarding/style.css',out+'/assets/auth.css');
await cp(root+'../brandbook/onboarding/phone.js',out+'/assets/phone.js');
await cp(root+'../brandbook/onboarding/countries.js',out+'/assets/countries.js');
await cp(root+'../brandbook/onboarding/preview-api.js',out+'/assets/preview-api.js');
let sha='unknown';try{sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
await writeFile(out+'/version.json',JSON.stringify({ui_sha:sha,backend_sha:'6e01c154a53759e3a122c56226dd835a6e079313'}));
await writeFile(out+'/index.html','<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; font-src \'self\'; img-src \'self\'; media-src \'self\'; connect-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'"><title>SashaTel</title><link rel="stylesheet" href="/assets/auth.css"><link rel="stylesheet" href="/assets/platform.css"><script defer src="/assets/icons.js"></script><script type="module" src="/assets/main.js"></script></head><body><a class="skip" href="#content">К содержанию</a><header class="topbar"><a class="wordmark" href="/">SashaTel</a></header><main id="content" tabindex="-1"><h1>Проверяем сессию…</h1></main></body></html>');
console.log('Built web/dist; same-origin /v1; UI '+sha);
