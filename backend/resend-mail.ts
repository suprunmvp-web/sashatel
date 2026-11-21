
import { MailDeliveryError, type MailPort } from './web-auth.ts';

type MailMessage = {
  id: string;
  email: string;
  code: string | null;
  purpose?: 'verify' | 'password_reset';
};

export class ResendMailProvider implements MailPort {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    if (!apiKey.trim() || !from.trim()) {
      throw new Error('Email provider configuration missing');
    }
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(message: MailMessage): Promise<void> {
    if (
      !/^[0-9a-f-]{36}$/i.test(message.id) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.email) ||
      (message.code !== null && !/^\d{6}$/.test(message.code))
    ) {
      throw new Error('Invalid email message');
    }

    const reset=message.purpose==='password_reset';
    if(reset && message.code===null)throw new Error('Reset email requires OTP');
    const hasCode=message.code!==null;
    const subject=reset?'Сброс пароля SashaTel':
      hasCode?`${message.code} — код подтверждения SashaTel`:'Безопасность аккаунта SashaTel';
    const body=reset
      ? `Код для восстановления пароля SashaTel: ${message.code}. Код действует 10 минут. Если вы не запрашивали сброс пароля, проигнорируйте письмо.`
      : hasCode
        ? `Ваш код подтверждения SashaTel: ${message.code}. Код действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.`
        : 'Если вы запрашивали регистрацию, но у вас уже есть аккаунт SashaTel, воспользуйтесь входом. Если вы ничего не запрашивали, проигнорируйте письмо.';
    const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
    const title=reset?'Восстановление пароля':hasCode?'Подтвердите почту':'Безопасность аккаунта';
    const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 12px;background:#0b0b0d;color:#f5f5f7;font-family:Arial,Helvetica,sans-serif"><table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:520px;margin:0 auto"><tr><td style="padding:24px 28px 18px"><img src="https://platform.sashatel.ru/assets/sashatel-symbol.svg" width="32" height="32" alt="" style="vertical-align:middle;border:0;display:inline-block"><span style="font-size:21px;font-weight:700;padding-left:10px;vertical-align:middle;color:#fff">SashaTel</span></td></tr><tr><td style="border:1px solid #2e2e36;border-radius:14px;padding:32px 28px;background:#151518"><h1 style="font-size:26px;line-height:1.2;margin:0 0 16px;font-weight:700;color:#fff">${title}</h1>${hasCode?`<p style="font-size:15px;line-height:1.6;color:#c4c4cd;margin:0 0 20px">${reset?'Введите этот код для сброса пароля.':'Введите этот код для подтверждения email.'}</p><p style="font-size:36px;line-height:1.3;font-weight:700;letter-spacing:9px;color:#f4cf55;margin:0 0 20px">${escape(message.code!)}</p><p style="font-size:13px;color:#a9a9b4;margin:0 0 18px">Код действителен 10 минут.</p>`:`<p style="font-size:15px;line-height:1.6;color:#c4c4cd;margin:0 0 20px">${escape(body)}</p>`}<p style="font-size:13px;line-height:1.6;color:#a9a9b4;margin:0">Если вы не запрашивали это действие, просто проигнорируйте письмо.</p></td></tr><tr><td style="padding:18px 28px;font-size:12px;color:#8f8f98">SashaTel · Безопасность аккаунта</td></tr></table></body></html>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `sashatel-auth-${message.id}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.email],
        subject,
        text: body,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Не пишем тело ошибки в лог: в нём могут быть данные запроса.
      throw new MailDeliveryError(response.status===408 || response.status===425 || response.status===429 || response.status>=500);
    }

    const result: unknown = await response.json();

    if (
      typeof result !== 'object' ||
      result === null ||
      !('id' in result) ||
      typeof result.id !== 'string'
    ) {
      throw new MailDeliveryError(true);
    }
  }
}
