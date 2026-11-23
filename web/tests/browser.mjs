import {chromium} from '../../brandbook/onboarding/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import pg from '../../.integration/backend/node_modules/pg/lib/index.js';

const evidence=process.env.EVIDENCE_DIR||'/tmp/sashatel-web-evidence';
await mkdir(evidence,{recursive:true});
const base='http://localhost:4174';
const browser=await chromium.launch({chromiumSandbox:true});
const failures=[];
const results=[];
const widths=[1440,1024,768,390];
const heading=(page,name)=>page.getByRole('heading',{name,exact:true}).waitFor();
const alert=(page,pattern)=>page.getByRole('alert').filter({hasText:pattern}).waitFor();
async function noOverflow(page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal scroll overflow');
}
async function viewportMatrix(page,prefix){
  for(const width of widths){
    await page.setViewportSize({width,height:900});
    await noOverflow(page);
    const shell=await page.locator('#content').boundingBox();
    assert(shell,'main container missing');
    assert(Math.abs(shell.x+shell.width/2-width/2)<3,'screen is not horizontally centered: '+prefix+' '+width);
    await page.screenshot({path:evidence+'/'+prefix+'-'+width+'.png',fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
}
try {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  page.on('pageerror',error=>failures.push(error.message));
  await page.goto(base+'/register/');
  await heading(page,'Давайте познакомимся.');
  assert.equal(await page.evaluate(()=>window.__SASHA_PREVIEW_ENABLED__),false);
  // Country selector must change both the visual prefix and the submitted dial code.
  await page.locator('#country-button').click();
  await page.locator('#country-search').fill('Алжир');
  await page.getByRole('button',{name:/Алжир/}).click();
  assert.equal(await page.locator('#phone-prefix').textContent(),'+213');
  assert.equal(await page.locator('#phone').getAttribute('data-dial'),'213');
  await page.locator('#country-button').click();
  assert.equal(await page.locator('#country-picker').isHidden(),false);
  await page.locator('#country-button').click();
  assert.equal(await page.locator('#country-picker').isHidden(),true);
  await page.locator('#country-button').click();
  await page.locator('#country-search').fill('Россия');
  await page.getByRole('button',{name:/Россия/}).click();
  assert.equal(await page.locator('#phone-prefix').textContent(),'+7');
  assert.equal(await page.locator('#phone').getAttribute('data-dial'),'7');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#phone').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),true);
  assert.equal(await page.locator('[name=email]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),true);
  await noOverflow(page);
  await page.setViewportSize({width:1440,height:900});
  await page.getByLabel('Имя',{exact:true}).fill('Александра');
  await page.getByLabel('Фамилия',{exact:true}).fill('Иванова');
  const email='web-'+Date.now()+'@example.test';
  await page.getByLabel('Почта',{exact:true}).fill(email);
  await page.getByLabel('Номер телефона',{exact:true}).fill('9261234567');
  await page.locator('[name=password]').fill('integration-password-123');
  await page.locator('[name=repeat_password]').fill('integration-password-123');
  await page.locator('[name=terms]').check();
  let registerBody;
  page.on('request',request=>{if(request.url().endsWith('/v1/auth/register'))registerBody=JSON.parse(request.postData());});
  await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
  await heading(page,'Подтвердите вашу почту');
  assert.deepEqual(Object.keys(registerBody).sort(),['email','first_name','last_name','password','phone']);
  assert.equal(registerBody.phone,'+79261234567');
  await viewportMatrix(page,'verify');
  await page.reload();
  await heading(page,'Подтвердите вашу почту');
  const otp=page.getByLabel('Шестизначный код подтверждения');
  await otp.fill('000000');
  await otp.press('Enter');
  await alert(page,/Код неверный|код неверный|истёк/);

  const snapshot=await page.request.get(base+'/v1/auth/bootstrap');
  const state=await snapshot.json();
  assert(state.challenge?.challenge_id,'verification challenge is missing');
  const id=state.challenge.challenge_id;
  let message;
  for(let i=0;i<100&&!message;i++){
    try{message=JSON.parse(await readFile('/tmp/sashatel-web-mail/'+id+'.json','utf8'));}
    catch{await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert(message?.code,'email sink code not delivered');
  await otp.fill(message.code);
  await otp.press('Enter');
  await page.getByRole('heading',{name:/Добро пожаловать/}).waitFor();
  await viewportMatrix(page,'welcome');

  await page.getByRole('button',{name:'Создать организацию',exact:true}).click();
  await heading(page,'Добавьте организацию.');
  const inn=page.getByLabel('ИНН организации или ИП');
  const dropdown=page.locator('#inn-suggestions');
  await inn.fill('770');
  assert.equal(await dropdown.isHidden(),true,'no panel below four digits');
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(await dropdown.isHidden(),true,'panel appeared before fourth digit');

  await inn.fill('7707');
  await page.getByRole('option',{name:/Проверка интеграции/}).waitFor();
  assert.equal(await page.getByRole('option').count(),2,'expected only actual backend results');
  assert.equal(await page.getByText('ООО «Компания 0001»').count(),0,'demo companies leaked');
  await inn.fill('770');
  assert.equal(await dropdown.isHidden(),true,'panel should close when fewer than 4 digits');
  await inn.fill('7707');
  await page.getByRole('option',{name:/Проверка интеграции/}).waitFor();
  await viewportMatrix(page,'lookup-suggestions');

  await page.getByRole('option',{name:/Проверка интеграции/}).click();
  await page.waitForFunction(()=>document.querySelector('[name=legal_name]')?.value==='ООО «Проверка интеграции»');
  assert.equal(await page.locator('[name=legal_name]').isDisabled(),true);
  assert.equal(await page.locator('[name=legal_address]').isDisabled(),true);
  await viewportMatrix(page,'lookup-selected');
  await page.locator('#company-consent').check();
  await page.getByRole('button',{name:'Создать организацию',exact:true}).click();
  const welcome = page.getByRole('dialog', {name: /Добро пожаловать/});
  await welcome.getByRole('link', {name: 'К верификации'}).waitFor();
  await welcome.getByRole('button', {name: 'Закрыть приветствие'}).click();
  await heading(page,'Статистика');
  const orgId=new URL(page.url()).pathname.split('/')[1];
  assert.match(orgId,/^[0-9a-f-]{36}$/);
  await page.reload();
  await heading(page,'Статистика');
  await noOverflow(page);
  results.push('Real auth, verified OTP, 4-digit suggestion threshold, debounce, 2 server results, stale dropdown reset, selected organization lookup, consent, DB persisted org, responsive 1440/1024/768/390');

  for(const width of widths){
    await page.setViewportSize({width,height:900});
    await noOverflow(page);
  }
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.locator('.platform-top').evaluate(node=>node.getBoundingClientRect().height),56);
  assert.equal(await page.locator('.sidebar .cabinet-profile').count(),1);
  await page.setViewportSize({width:390,height:900});
  await page.getByRole('button',{name:'Меню кабинета'}).click();
  assert.equal(await page.locator('.sidebar').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.locator('.sidebar').waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Переключить тему'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.locator('.sidebar').getByRole('link',{name:'Транки',exact:true}).click();
  await heading(page,'Транки');
  await page.reload();
  await heading(page,'Транки');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.getByRole('button',{name:'Подключить транк'}).click();
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Закрыть'}).count(),1);
  assert.deepEqual(await page.getByRole('dialog').locator('input').evaluateAll(inputs=>inputs.map(input=>input.name)),['name']);
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Создать транк',exact:true}).isDisabled(),false);
  await page.keyboard.press('Escape');
  await page.locator('.workspace-control').click();
  const opening = page.waitForResponse(response=>response.url().endsWith('/v1/session/organization') && response.request().method()==='POST');
  await page.getByRole('group',{name:'Выбор организации'}).getByRole('button',{name:/ООО «Проверка интеграции»/}).click();
  assert.equal((await opening).status(),200);
  await heading(page,'Статистика');
  await page.locator('.sidebar').getByRole('link',{name:'Настройки',exact:true}).click();
  await heading(page,'Настройки');
  assert.equal(await page.getByRole('button',{name:'Сохранить настройки'}).isDisabled(),true);
  await page.getByRole('tab',{name:'Пользователи',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'Пользователи',exact:true}).getAttribute('aria-selected'),'true');
  results.push('Cabinet widths, persistent theme, deep-link trunks, safe trunk dialog, server-validated organization switch and settings tabs');

  // Internal permissions are derived from Backend, never a URL query or a client role.
  await page.goto(base+'/admin/');
  await heading(page,'Доступ запрещён');
  const adminDb=new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});
  try{
    await adminDb.query(
      "INSERT INTO web_auth.internal_staff(user_id,role) SELECT id,'reviewer' FROM control.users WHERE lower(login)=lower($1)",
      [email]
    );
  }finally{await adminDb.end();}
  await page.goto(base+'/admin/');
  await heading(page,'Обзор');
  await page.getByText('ООО «Проверка интеграции»').waitFor();
  const orgReview=page.locator('[data-review-org="'+orgId+'"][data-review-decision="verified"]');
  await orgReview.locator('xpath=../preceding-sibling::button').click();
  await orgReview.click();
  await page.locator('[name=evidence]').fill('Документы, проверенные сотрудником SashaTel');
  await page.locator('[name=explanation]').fill('Установлено право заявителя представлять компанию');
  await page.getByRole('button',{name:'Подтвердить организацию'}).click();
  await page.getByText('Организация верифицирована',{exact:true}).waitFor();
  await page.goto(base+'/'+orgId+'/');
  await heading(page,'Статистика');
  assert.equal(await page.locator('.cabinet-notice').count(),0,'verified org remains marked unverified');
  results.push('Internal admin 403 for customer, DBA-gated reviewer role, verified organization persisted, customer sees updated status');

  const recoveryContext=await browser.newContext({viewport:{width:1440,height:900}});
  const recovery=await recoveryContext.newPage();
  recovery.on('pageerror',error=>failures.push(error.message));
  await recovery.goto(base+'/recovery/');
  await heading(recovery,'Восстановление пароля');
  await viewportMatrix(recovery,'recovery-email');
  const seen=new Set(await readdir('/tmp/sashatel-web-mail'));
  await recovery.locator('[name=email]').fill(email);
  await recovery.getByRole('button',{name:'Отправить код подтверждения'}).click();
  await heading(recovery,'Подтвердите вашу почту');
  let resetMessage;
  for(let i=0;i<100&&!resetMessage;i++){
    for(const file of await readdir('/tmp/sashatel-web-mail')){
      if(seen.has(file))continue;
      try{resetMessage=JSON.parse(await readFile('/tmp/sashatel-web-mail/'+file,'utf8'));}catch{}
      if(resetMessage)break;
    }
    if(!resetMessage)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.match(resetMessage?.code||'',/^\d{6}$/,'recovery email sink did not receive a code');
  await recovery.locator('#recovery-code').fill(resetMessage.code);
  await recovery.getByRole('button',{name:'Подтвердить',exact:true}).click();
  await heading(recovery,'Новый пароль');
  const newPassword='integration-reset-password-456';
  await recovery.locator('[name=password]').fill(newPassword);
  await recovery.locator('[name=repeat]').fill(newPassword);
  for (const name of ['password', 'repeat']) {
    const field = recovery.locator(`[name=${name}]`);
    const other = recovery.locator(`[name=${name === 'password' ? 'repeat' : 'password'}]`);
    const toggle = recovery.locator(`[aria-controls="recovery-${name}"]`);
    assert.equal(await toggle.locator('[data-icon="eye"] svg').count(), 1);
    await toggle.click();
    assert.equal(await field.getAttribute('type'), 'text');
    assert.equal(await other.getAttribute('type'), 'password');
    assert.equal(await field.inputValue(), newPassword);
    await toggle.press('Space');
    assert.equal(await field.getAttribute('type'), 'password');
  }
  await recovery.locator('#recovery-form button[type=submit]').click();
  await heading(recovery,'Пароль изменён');
  await recovery.getByRole('link',{name:'Вернуться ко входу'}).click();
  await recovery.locator('[name=email]').fill(email);
  await recovery.locator('[name=password]').fill(newPassword);
  await recovery.getByRole('button',{name:'Войти',exact:true}).click();
  await heading(recovery,'Статистика');
  results.push('Password recovery code, password reset and fresh login against real Backend and PostgreSQL');
  await recoveryContext.close();
  await context.close();
  assert.deepEqual(failures,[]);
  await writeFile(evidence+'/results.json',JSON.stringify({
    ui_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    backend_sha:'f953952b37da3415f19c7bd95f26f8aa5bba2917',
    results,viewports:widths,pageErrors:failures,
    limitations:['DaData and email providers are test fixtures in this CI; YC real-provider acceptance is separate','Password reset mail delivery uses a test sink, not live Resend']
  },null,2));
  console.log('Real backend/PostgreSQL browser acceptance and DaData suggestions UI passed');
}finally{await browser.close();}
