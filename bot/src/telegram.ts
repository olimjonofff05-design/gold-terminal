import { env, log } from './util.ts';

export const DRY = process.argv.includes('--dry');

/** Kanalga HTML xabar. --dry rejimida faqat konsolga chiqaradi. */
export async function send(html: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  if (DRY) {
    console.log('\n──────── TELEGRAM (dry) ────────\n' + html + '\n────────────────────────────────');
    return true;
  }
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env('TELEGRAM_CHAT_ID'),
      text: html.slice(0, 4096),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: !!opts.silent,
    }),
  });
  const j = (await r.json()) as { ok: boolean; description?: string };
  if (!j.ok) log('Telegram xato:', j.description);
  return j.ok;
}
