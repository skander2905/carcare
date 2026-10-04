# Sending real email

CarCare sends email in a standard way called **SMTP**. Every email service
understands it, so switching services only means changing a few lines in
`.env`. No code changes.

There are three set-ups:

| Where                        | Use         | Real emails?                                              |
| ---------------------------- | ----------- | --------------------------------------------------------- |
| Your computer                | **Mailpit** | No. It catches everything at http://localhost:8025        |
| Online, no domain yet        | **Gmail**   | Yes, up to about 500 a day                                |
| Online, with your own domain | **Brevo**   | Yes, 300 a day free, and much less likely to land in spam |

After any change to `.env`, restart the API and the worker.

## 1. On your computer: Mailpit

```bash
sudo /snap/bin/docker compose up -d mailpit
```

In `.env`:

```
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM=CarCare <reminders@carcare.local>
```

## 2. Online, without a domain: Gmail

A free address like `something.vercel.app` belongs to Vercel, not to you. You
can't add the settings that prove your emails are genuine, so services like
Brevo can't send in your name from it. Gmail can, because Google vouches for
its own emails.

1. Turn on 2-step verification for your Google account.
2. Go to https://myaccount.google.com/apppasswords and create an app password
   called "CarCare". Google shows 16 letters. Copy them.
3. In the server's settings (or `.env`):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=the-16-letters-without-spaces
MAIL_FROM=CarCare <your-address@gmail.com>
```

`MAIL_FROM` must be the same Gmail address, or Gmail rewrites it.

Never commit the app password. `.env` is not in git. On a hosting platform, put
it in that platform's "environment variables" or "secrets" page.

## 3. Online, with your own domain: Brevo

When you buy a domain (for example `carcare.tn`, around $10 a year):

1. Create a free account at https://www.brevo.com.
2. In Brevo: **Senders, Domains & Dedicated IPs → Domains → Add a domain**.
   Brevo gives you a few DNS records (SPF, DKIM, DMARC). Add them where you
   bought the domain. Brevo checks them, which can take up to a day.
3. In Brevo: **SMTP & API → SMTP**. Create an SMTP key.
4. Settings:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=the-login-Brevo-shows-on-that-page
SMTP_PASSWORD=the-SMTP-key
MAIL_FROM=CarCare <reminders@your-domain.tn>
```

## Also set these when online

```
WEB_APP_URL=https://your-app-address      # links in emails open this
API_PUBLIC_URL=https://your-api-address   # Gmail's "Unsubscribe" button calls this
```

## How to tell it works

When the API or the worker starts, its log says one of:

- `Email ready: smtp.gmail.com:587, sending as …`: good.
- `Email is configured but … refused us: …`: a setting is wrong. The message
  says which server answered and why.
- `Email is off (no SMTP_HOST)`: no email set up. Reminders appear only in the app.

Then create an account with your real address. The "Confirm your email" message
should arrive within a minute. If it doesn't, check the spam folder first.
