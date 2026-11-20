
import type { MailPort } from './web-auth.ts';

type MailMessage = {
  id: string;
  email: string;
  code: string | null;
};

export class ResendMailProvider implements MailPort {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey.trim() || !from.trim()) {
      throw new Error('Email provider configuration missing');
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (
      !/^[0-9a-f-]{36}$/i.test(message.id) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.email) ||
      (message.code !== null && !/^\d{6}$/.test(message.code))
    ) {
      throw new Error('Invalid email message');
    }

    const hasCode = message.code !== null;

    const subject = hasCode
      ? `${message.code} — код подтверждения SashaTel`
      : 'Безопасность аккаунта SashaTel';

    const body = hasCode
      ? `Ваш код подтверждения SashaTel: ${message.code}\n\nЕсли вы не запрашивали код, проигнорируйте письмо.`
      : 'Если вы запрашивали регистрацию, но у вас уже есть аккаунт SashaTel, воспользуйтесь входом. Если вы ничего не запрашивали, проигнорируйте письмо.';

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
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Не пишем тело ошибки в лог: в нём могут быть данные запроса.
      throw new Error(`Email provider rejected request: HTTP ${response.status}`);
    }

    const result: unknown = await response.json();

    if (
      typeof result !== 'object' ||
      result === null ||
      !('id' in result) ||
      typeof result.id !== 'string'
    ) {
      throw new Error('Invalid email provider response');
    }
  }
}
