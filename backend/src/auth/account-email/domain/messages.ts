import { escapeHtml } from '../../../notifications/domain/digest.js';

/**
 * The account emails: confirm your address, reset your password. Short, one
 * button each, and the link written out in full for clients that strip HTML.
 */

export interface AccountEmail {
  subject: string;
  text: string;
  html: string;
}

export function verifyEmailMessage(displayName: string, link: string): AccountEmail {
  return message({
    subject: 'Confirm your email for CarCare',
    greeting: `Hello ${displayName},`,
    lines: ['Please confirm this is your email address, so CarCare can send you reminders.'],
    button: 'Confirm my email',
    link,
    footer: "This link works for 48 hours. If you didn't create a CarCare account, ignore this email.",
  });
}

export function resetPasswordMessage(displayName: string, link: string): AccountEmail {
  return message({
    subject: 'Reset your CarCare password',
    greeting: `Hello ${displayName},`,
    lines: ['Someone asked to reset the password for your CarCare account. If it was you, choose a new one:'],
    button: 'Choose a new password',
    link,
    footer:
      "This link works for 1 hour and only once. If you didn't ask for it, ignore this email: your password stays the same.",
  });
}

function message(parts: {
  subject: string;
  greeting: string;
  lines: string[];
  button: string;
  link: string;
  footer: string;
}): AccountEmail {
  const text = [parts.greeting, '', ...parts.lines, '', parts.link, '', parts.footer].join('\n');
  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(parts.greeting)}</p>
${parts.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${escapeHtml(parts.link)}" style="background:#1f2328;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(parts.button)}</a></p>
<p style="color:#59636e;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(parts.link)}</p>
<p style="color:#59636e;font-size:13px">${escapeHtml(parts.footer)}</p>
</body></html>`;
  return { subject: parts.subject, text, html };
}
