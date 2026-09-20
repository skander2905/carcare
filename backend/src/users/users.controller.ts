import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { UserResponse } from '../auth/dto/auth.response.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { toUserResponse } from './user.mapper.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * `me` rather than `:id` throughout. There is no endpoint that takes a user
   * id, so there is no endpoint where passing someone else's is even
   * expressible — the authorisation check cannot be forgotten because there is
   * nothing to check.
   */
  @Get('me')
  @ApiOperation({ summary: 'The authenticated user' })
  @ApiOkResponse({ type: UserResponse })
  async findMe(@CurrentUser() current: AuthenticatedUser): Promise<UserResponse> {
    const user = await this.users.findById(current.id);
    // The access token is valid, so the row existed 15 minutes ago at worst.
    return toUserResponse(user!);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update display name and preferences' })
  @ApiOkResponse({ type: UserResponse })
  async updateMe(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return toUserResponse(await this.users.updateProfile(current.id, dto));
  }
}
