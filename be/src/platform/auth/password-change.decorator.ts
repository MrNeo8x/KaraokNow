import { SetMetadata } from '@nestjs/common';
export const ALLOW_PASSWORD_CHANGE = 'allow_password_change';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);
