import {chromium} from '../../brandbook/onboarding/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
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
  await heading(page,'Статистика');
  const orgId=new URL(page.url()).pathname.split('/')[1];
  assert.match(orgId,/^[0-9a-f-]{36}$/);
  await page.reload();
  await heading(page,'Статистика');
  await noOverflow(page);
  results.push('Real auth, verified OTP, 4-digit suggestion threshold, debounce, 2 server results, stale dropdown reset, selected organization lookup, consent, DB persisted org, responsive 1440/1024/768/390');

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
  await page.locator('[data-review-org="'+orgId+'"][data-review-decision="verified"]').click();
  await page.locator('[name=evidence]').fill('Документы, проверенные сотрудником SashaTel');
  await page.locator('[name=explanation]').fill('Установлено право заявителя представлять компанию');
  await page.getByRole('button',{name:'Подтвердить организацию'}).click();
  await page.getByText('Верифицирована',{exact:true}).waitFor();
  await page.goto(base+'/'+orgId+'/');
  await heading(page,'Статистика');
  assert.equal(await page.locator('.status-label').count(),0,'verified org remains marked unverified');
  results.push('Internal admin 403 for customer, DBA-gated reviewer role, verified organization persisted, customer sees updated status');

  await page.goto(base+'/recovery/');
  await heading(page,'Восстановление пароля');
  await viewportMatrix(page,'recovery-email');
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
