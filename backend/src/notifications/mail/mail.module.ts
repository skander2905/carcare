import { Global, Module } from '@nestjs/common';
import { Mailer } from './mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/**
 * Global, like StorageModule: email is infrastructure. Reminder digests use it,
 * and so do the account emails — confirming an address, resetting a password.
 */
@Global()
@Module({
  providers: [{ provide: Mailer, useClass: SmtpMailer }],
  exports: [Mailer],
})
export class MailModule {}
