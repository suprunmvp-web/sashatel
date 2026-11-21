import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {MailDeliveryError} from './web-auth.ts';
import {ResendMailProvider} from './resend-mail.ts';

const msg=()=>({id:randomUUID(),email:'test@example.test',code:'123456'});
const provider=()=>new ResendMailProvider('synthetic-test-key','SashaTel <auth@example.test>');

test('Resend maps permanent and temporary errors without leaking response bodies',async()=>{
  const original=globalThis.fetch;
  try {
    for(const [status,retryable] of [
      [400,false],[401,false],[403,false],[422,false],
      [408,true],[425,true],[429,true],[500,true],[503,true],
    ] as const) {
      globalThis.fetch=async()=>new Response('do-not-log-pii',{status});
      await assert.rejects(provider().send(msg()),error=>{
        assert(error instanceof MailDeliveryError);
        assert.equal(error.retryable,retryable);
        assert(!error.message.includes('do-not-log-pii'));
        return true;
      });
    }
  } finally {
    globalThis.fetch=original;
  }
});

test('Resend sends stable request idempotency key with OTP in email subject',async()=>{
  const original=globalThis.fetch;
  const message=msg();
  let calls=0;
  try {
    globalThis.fetch=async(input,init)=>{
      assert.equal(String(input),'https://api.resend.com/emails');
      assert.equal(init?.method,'POST');
      const headers=new Headers(init?.headers);
      assert.equal(headers.get('Idempotency-Key'),'sashatel-auth-'+message.id);
      const body=JSON.parse(String(init?.body));
      assert(body.subject.startsWith(message.code));
      assert.equal(body.to[0],message.email);
      assert(!String(init?.body).includes('synthetic-test-key'));
      calls++;
      return Response.json({id:randomUUID()},{status:200});
    };
    await provider().send(message);
    assert.equal(calls,1);
  } finally {
    globalThis.fetch=original;
  }
});

test('Resend generates branded reset email with distinct purpose and 6-digit OTP',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(_input,init)=>{
      const body=JSON.parse(String(init?.body));
      assert.equal(body.from,'SashaTel <auth@example.test>');
      assert.equal(body.subject,'Сброс пароля SashaTel');
      assert(body.html.includes('sashatel-symbol.svg'));
      assert.match(body.html,/SashaTel/);
      assert.match(body.html,/123456/);
      assert.match(body.text,/123456/);
      return Response.json({id:randomUUID()},{status:200});
    };
    await provider().send({...msg(),purpose:'password_reset'});
  }finally{globalThis.fetch=original;}
});

test('Resend treats invalid successful response as retryable unknown outcome',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({unexpected:true},{status:200});
    await assert.rejects(provider().send(msg()),error=>{
      assert(error instanceof MailDeliveryError);
      assert.equal(error.retryable,true);
      return true;
    });
  } finally {
    globalThis.fetch=original;
  }
});
