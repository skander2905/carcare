import { describe, expect, it } from 'vitest';
import { renderDigest } from './digest.js';

const item = (title: string) => ({ title, body: 'Due in 12 days.', link: 'https://app.example/vehicles/1' });
const SETTINGS = 'https://app.example/unsubscribe?token=abc';

describe('renderDigest', () => {
  it('uses the one title as the subject when there is one', () => {
    expect(renderDigest('Sam', [item('Oil and filter is due soon · Peugeot 208')], SETTINGS).subject).toBe(
      'Oil and filter is due soon · Peugeot 208',
    );
  });

  it('counts when there are several', () => {
    const email = renderDigest('Sam', [item('A'), item('B'), item('C')], SETTINGS);
    expect(email.subject).toBe('3 car reminders need attention');
    expect(email.text).toContain('• B');
  });

  it('always says how to stop them', () => {
    const email = renderDigest('Sam', [item('A')], SETTINGS);
    expect(email.text).toContain(SETTINGS);
    expect(email.html).toContain(`href="${SETTINGS}"`);
  });

  it('escapes what the user typed', () => {
    const email = renderDigest('<b>Sam</b>', [item('<img src=x onerror=alert(1)> is due')], SETTINGS);
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  });
});
