import {chromium} from '../../brandbook/onboarding/node_modules/playwright/index.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.env.EVIDENCE_DIR||'/tmp/sashatel-ui-review';
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
const base=process.env.REVIEW_URL||'http://127.0.0.1:4174/ui-review.html';
let all=0;
for(const width of [1440,1024,768,390]){
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Статистика'}).waitFor();
  const overflow=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth, offenders:[...document.querySelectorAll('body *')].map(el=>({el,rect:el.getBoundingClientRect()})).filter(o=>o.rect.right>innerWidth+2||o.rect.left< -2).slice(0,15).map(o=>({tag:o.el.tagName,cls:o.el.className?.baseVal||o.el.className,right:Math.round(o.rect.right),left:Math.round(o.rect.left)}))}));
  if(overflow.overflow)console.error('OVERFLOW DIAGNOSTICS',width,theme,JSON.stringify(overflow.offenders));
  await page.screenshot({path:dir+'/'+width+'-'+theme+'-first-frame.png',fullPage:true});
  assert.equal(overflow.overflow,false,'horizontal overflow '+width+' '+theme);
  if(theme==='dark')await page.locator('#theme').click();
  await page.screenshot({path:dir+'/'+width+'-'+theme+'-empty.png',fullPage:true});
  await page.locator('#state').click();
  await page.getByText('Анна Иванова').waitFor();
  await page.getByRole('button',{name:'По регионам'}).click();
  await page.getByText('Краснодарский край').waitFor();
  await page.getByRole('button',{name:'По сотрудникам'}).click();
  await page.getByText('Анна Иванова').waitFor();
  await page.locator('[data-ux-day="3"]').focus();
  await page.locator('.ux-day-tooltip').getByText('Инициаций').waitFor();
  await page.getByText('382').waitFor();
  await page.screenshot({path:dir+'/'+width+'-'+theme+'-populated.png',fullPage:true});
  for(const section of ['history','trunks','employees','integrations','billing']){
   await page.locator('[data-nav='+section+']').click();
   assert(await page.locator('.ux-page').isVisible(),section+' is empty');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+section+' '+width);
   if(width===1440&&theme==='light')await page.screenshot({path:dir+'/'+section+'.png',fullPage:true});
  }
  await page.locator('.ux-switcher summary').click();
  await page.locator('[data-admin]').click();
  await page.getByRole('heading',{name:'Обзор'}).waitFor();
  if(width===1440&&theme==='light')await page.screenshot({path:dir+'/admin.png',fullPage:true});
  assert.deepEqual(errors,[],'JS page errors '+width+' '+theme);
  all++;await page.close();
 }
}
console.log('PASS UI visual review: '+all+' viewport/theme combinations, populated & empty stats, drilldown, tooltips, all sections, admin switching, zero horizontal overflow.');
await browser.close();
