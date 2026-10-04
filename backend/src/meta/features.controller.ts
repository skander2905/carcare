import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { Mailer } from '../notifications/mail/mailer.js';
import { ObjectStorage } from '../storage/object-storage.js';

export class FeaturesResponse {
  @ApiProperty({
    description: 'Whether this server can send email: confirmations, password resets, digests.',
  })
  email: boolean;

  @ApiProperty({ description: 'Whether files can be attached (receipts, papers).' })
  files: boolean;
}

/**
 * What this server can do, so the web app does not offer what would fail.
 *
 * Email and storage are optional configuration. Online on Render's free plan
 * email is off — free services cannot reach SMTP ports — and the app must not
 * ask people to confirm an address, or offer "forgot password", when nothing
 * would arrive.
 */
@ApiTags('meta')
@Controller('features')
export class FeaturesController {
  constructor(
    private readonly mailer: Mailer,
    private readonly storage: ObjectStorage,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Which optional features this server has: email, file storage' })
  @ApiOkResponse({ type: FeaturesResponse })
  features(): FeaturesResponse {
    return { email: this.mailer.enabled, files: this.storage.enabled };
  }
}
