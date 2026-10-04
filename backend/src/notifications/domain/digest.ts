/**
 * The email a user receives: every notification still owed one, in a single
 * message. A sweep that finds the oil, the tyres and the insurance all due at
 * once sends one email, not three.
 */

export interface DigestItem {
  title: string;
  body: string;
  /** Absolute URL of the page that deals with it. */
  link: string;
}

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderDigest(displayName: string, items: DigestItem[], unsubscribeUrl: string): DigestEmail {
  const subject = items.length === 1 ? items[0].title : `${items.length} car reminders need attention`;

  const text = [
    `Hello ${displayName},`,
    '',
    ...items.flatMap((item) => [`• ${item.title}`, `  ${item.body}`, `  ${item.link}`, '']),
    `You are receiving this because email reminders are on. Stop them: ${unsubscribeUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;max-width:560px;margin:0 auto;padding:24px">
<p>Hello ${escapeHtml(displayName)},</p>
<ul style="list-style:none;padding:0;margin:0">
${items
  .map(
    (item) =>
      `<li style="border:1px solid #d0d7de;border-radius:8px;padding:12px 16px;margin:0 0 12px">` +
      `<a href="${escapeHtml(item.link)}" style="color:#1f2328;font-weight:600;text-decoration:none">${escapeHtml(item.title)}</a>` +
      `<div style="color:#59636e;margin-top:4px">${escapeHtml(item.body)}</div></li>`,
  )
  .join('\n')}
</ul>
<p style="color:#59636e;font-size:13px">You are receiving this because email reminders are on. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#59636e">Stop these emails</a>.</p>
</body></html>`;

  return { subject, text, html };
}

/** Titles carry user-typed names — a reminder called "<script>" must arrive as text. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
