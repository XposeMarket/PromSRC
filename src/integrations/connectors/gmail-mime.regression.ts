// Regression: Gmail MIME builder. Run: npm run test:gmail-mime
// Guards the 2026-10-09 bug where a non-ASCII subject was sent as raw UTF-8 and
// arrived double-encoded ("âœ…" mojibake), and covers HTML/attachments/threading.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildGmailMimeMessage, encodeHeaderValue, loadGmailAttachments, guessMimeType } from './gmail-mime.js';

let failures = 0;
function check(name: string, cond: unknown) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

function decodeWords(value: string): string {
  return value.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_m, b) => Buffer.from(b, 'base64').toString('utf8'));
}
function headerOf(msg: string, name: string): string {
  const head = msg.split('\r\n\r\n')[0];
  const m = head.match(new RegExp(`^${name}: (.*(?:\\r\\n .*)*)`, 'm'));
  return m ? m[1] : '';
}

// 1. Unicode subject is RFC 2047 encoded and round-trips.
const subject = 'Prom test 1/4: plain text ✅ — émojis & "quotes" 日本語 🚀';
const plain = buildGmailMimeMessage({ to: 'a@example.com', subject, text: 'café 🚀', boundarySeed: 't' });
const rawSubject = headerOf(plain, 'Subject');
check('unicode subject is encoded-word', /^=\?UTF-8\?B\?/.test(rawSubject));
check('unicode subject round-trips', decodeWords(rawSubject) === subject);
check('encoded-word lines stay <= 76 chars', rawSubject.split('\r\n').every((l) => l.trim().length <= 76));
check('ascii subject untouched', encodeHeaderValue('Hello world') === 'Hello world');
check('header injection stripped', !encodeHeaderValue('Hi\r\nBcc: evil@x.com').includes('\r\nBcc'));
check('plain body is base64 utf-8', plain.includes('Content-Type: text/plain; charset=UTF-8') && plain.includes(Buffer.from('café 🚀').toString('base64')));

// 2. HTML alternative.
const html = buildGmailMimeMessage({ to: 'a@example.com', subject: 's', text: 'fallback', html: '<b>hi</b>', boundarySeed: 't' });
check('html uses multipart/alternative', html.includes('multipart/alternative; boundary="alt_t"'));
check('html part present', html.includes('Content-Type: text/html; charset=UTF-8') && html.includes(Buffer.from('<b>hi</b>').toString('base64')));
check('plain fallback before html', html.indexOf('text/plain') < html.indexOf('text/html'));

// 3. Attachments + HTML → multipart/mixed wrapping alternative.
const att = buildGmailMimeMessage({
  to: 'a@example.com', subject: 's', text: 't', html: '<p>x</p>', boundarySeed: 't',
  attachments: [
    { filename: 'notes.txt', content: Buffer.from('hello') },
    { filename: 'résumé.pdf', mimeType: 'application/pdf', content: Buffer.alloc(200, 1) },
  ],
});
check('mixed wrapper', att.includes('multipart/mixed; boundary="mix_t"'));
check('alternative nested in mixed', att.indexOf('mix_t') < att.indexOf('alt_t'));
check('txt attachment', att.includes('filename="notes.txt"') && att.includes('Content-Type: text/plain; name="notes.txt"'));
check('non-ascii filename has filename*', att.includes("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"));
check('closing boundaries', att.includes('--mix_t--') && att.includes('--alt_t--'));
check('base64 lines wrapped at 76', att.split('\r\n').every((l) => l.length <= 998));

// 4. Reply threading headers.
const reply = buildGmailMimeMessage({ to: 'a@example.com', subject: 'Re: s', text: 'r', inReplyTo: '<abc@mail.gmail.com>', boundarySeed: 't' });
check('In-Reply-To set', headerOf(reply, 'In-Reply-To') === '<abc@mail.gmail.com>');
check('References defaults to In-Reply-To', headerOf(reply, 'References') === '<abc@mail.gmail.com>');

// 5. Cc/Bcc + non-ASCII display name.
const cc = buildGmailMimeMessage({ to: 'José <j@example.com>, b@example.com', cc: 'c@example.com', bcc: 'd@example.com', subject: 's', text: 't' });
check('cc header', headerOf(cc, 'Cc') === 'c@example.com');
check('bcc header', headerOf(cc, 'Bcc') === 'd@example.com');
check('display name encoded', /^=\?UTF-8\?B\?[^?]+\?= <j@example.com>, b@example.com$/.test(headerOf(cc, 'To')));

// 6. Attachment loading from disk.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-mime-'));
fs.writeFileSync(path.join(dir, 'a.csv'), 'x,y\n1,2\n');
const loaded = loadGmailAttachments([{ path: 'a.csv' }, path.join(dir, 'a.csv')], dir);
check('loads relative + absolute paths', loaded.length === 2 && loaded[0].content.toString() === 'x,y\n1,2\n');
check('guesses csv mime', loaded[0].mimeType === 'text/csv' && guessMimeType('x.png') === 'image/png' && guessMimeType('x.bin') === 'application/octet-stream');
let threw = false;
try { loadGmailAttachments([{ path: 'missing.txt' }], dir); } catch { threw = true; }
check('missing attachment throws', threw);
fs.rmSync(dir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall gmail-mime checks passed');
