import {chromium} from '../../brandbook/onboarding/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const evidence=process.env.EVIDENCE_DIR||'/tmp/sashatel-web-evidence';await mkdir(evidence,{recursive:true});
const base='http://localhost:4174',browser=await chromium.launch({chromiumSandbox:true}),errors=[],results=[];
async function heading(page,name){await page.getByRole('heading',{name,exact:true}).waitFor();}
async function alert(page,pattern){await page.getByRole('alert').filter({hasText:pattern}).waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/register/');await heading(page,'Давайте познакомимся.');
 await page.getByLabel('Имя',{exact:true}).fill('Александра');
 await page.getByLabel('Фамилия',{exact:true}).fill('Иванова');
 const email='web-'+Date.now()+'@example.test';
 await page.getByLabel('Почта',{exact:true}).fill(email);
 await page.getByLabel('Номер телефона',{exact:true}).fill('9261234567');
 await page.locator('[name=password]').fill('integration-password-123');
 await page.locator('[name=terms]').check();
 let registerBody;page.on('request',r=>{if(r.url().endsWith('/v1/auth/register'))registerBody=JSON.parse(r.postData());});
 await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();await heading(page,'Подтвердите вашу почту');
 assert.deepEqual(Object.keys(registerBody).sort(),['email','first_name','last_name','password','phone']);
 assert.equal(registerBody.phone,'+79261234567');
 await page.reload();await heading(page,'Подтвердите вашу почту');
 await page.getByLabel('Шестизначный код подтверждения').fill('000000');await page.getByLabel('Шестизначный код подтверждения').press('Enter');await alert(page,/неверный или истёк/);
 const snapshot=await page.request.get(base+'/v1/auth/bootstrap');const state=await snapshot.json();const id=state.challenge.challenge_id;
 let message;for(let i=0;i<100&&!message;i++){try{message=JSON.parse(await readFile('/tmp/sashatel-web-mail/'+id+'.json','utf8'));}catch{await new Promise(r=>setTimeout(r,100));}}
 assert(message?.code);await page.getByLabel('Шестизначный код подтверждения').fill(message.code);await page.getByLabel('Шестизначный код подтверждения').press('Enter');
 await page.getByRole('heading',{name:/Добро пожаловать/}).waitFor();
 await page.getByRole('button',{name:'Создать организацию',exact:true}).click();
 await page.getByLabel('ИНН организации или ИП').fill('1234567890');await page.getByLabel('ИНН организации или ИП').press('Enter');await alert(page,/ИНН/);
 await page.getByLabel('ИНН организации или ИП').fill('7707083893');await page.getByLabel('ИНН организации или ИП').press('Enter');await heading(page,'Подтвердите организацию.');
 await page.getByRole('button',{name:'Создать организацию',exact:true}).click();await heading(page,'Статистика');
 const orgId=new URL(page.url()).pathname.split('/')[1];assert.match(orgId,/^[0-9a-f-]{36}$/);
 await page.reload();await heading(page,'Статистика');await noOverflow(page);
 await page.goto(base+'/'+orgId+'/profile/');await heading(page,'Профиль');
 await page.getByText('Александра',{exact:true}).first().waitFor();await page.getByText('Иванова',{exact:true}).waitFor();await page.getByText('+79261234567',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert(!saved.includes('integration-password-123'));assert(!/Bearer|access_token|refresh_token/.test(saved));
 await page.locator('.profile-menu summary').click();await page.getByRole('button',{name:'Выйти',exact:true}).click();await heading(page,'Добро пожаловать.');
 await page.getByLabel('Email',{exact:true}).fill(email);await page.locator('[name=password]').fill('integration-password-123');await page.getByRole('button',{name:'Войти',exact:true}).click();await heading(page,'Выберите организацию');
 await page.getByRole('button',{name:'ООО «Проверка интеграции»',exact:true}).click();await heading(page,'Статистика');
 await page.goto(base+'/'+orgId+'/profile/');await heading(page,'Профиль');await page.getByText('+79261234567',{exact:true}).waitFor();
 await page.goto(base+'/admin/');await heading(page,'Обзор');await page.getByRole('heading',{name:'Служебный доступ недоступен',exact:true}).waitFor();
 assert.equal(await page.getByText('ООО «Пример организации»',{exact:true}).count(),0);
 await page.goto(base+'/11111111-1111-4111-8111-111111111111/');await page.getByRole('heading',{name:/Доступ запрещён|Страница не найдена|Не удалось выполнить запрос/}).waitFor();
 await context.close();results.push('REAL Backend/PostgreSQL: strict DTO, email sink, challenge reload, wrong code, INN validation, create, UUID reload, profile after logout/login, admin deny, foreign UUID deny, credential storage');
 for(const width of [1440,1024,768,390])for(const theme of ['dark','light']){
  const ctx=await browser.newContext({viewport:{width,height:1000}});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(value=>localStorage.setItem('sashatel.web.theme',value),theme);
  await p.goto(base+'/279a66cd-c1cc-4d19-9c09-3490e9049d0a/?preview=1');await heading(p,'Статистика');await noOverflow(p);
  await p.screenshot({path:evidence+'/'+width+'-'+theme+'-client.png',fullPage:true});
  await p.getByRole('link',{name:'Транки',exact:true}).click();await heading(p,'Транки');await p.getByRole('button',{name:'Проверить CSV номеров',exact:false}).click();
  await p.getByRole('dialog').waitFor();await p.getByRole('dialog').press('Escape');assert.equal(await p.getByRole('dialog').isVisible(),false);
  await p.goto(base+'/admin/?preview=1&role=manager');await heading(p,'Обзор');await noOverflow(p);
  await p.screenshot({path:evidence+'/'+width+'-'+theme+'-admin.png',fullPage:true});
  await p.getByRole('button',{name:'Действия организации',exact:true}).click();assert.equal(await p.locator('#admin-operation option[value=payment-date]').count(),0);
  await p.getByRole('dialog').press('Escape');
  await p.goto(base+'/admin/employees/?preview=1&role=manager');await heading(p,'Сотрудники');assert.equal(await p.getByRole('button',{name:'Пригласить сотрудника SashaTel',exact:true}).isDisabled(),true);
  await p.reload();await heading(p,'Сотрудники');await noOverflow(p);await ctx.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(evidence+'/results.json',JSON.stringify({ui_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),backend_sha:'6e01c154a53759e3a122c56226dd835a6e079313',results,viewport_matrix:[1440,1024,768,390],themes:['dark','light'],consoleErrors:errors,limitations:['DaData test port/email sink are not live providers','Other section writes unavailable','YC HTTPS/browser restart/scale-out/legal gates require staging']},null,2));
 console.log('Real integration + shell browser checks passed');
}finally{await browser.close();}
