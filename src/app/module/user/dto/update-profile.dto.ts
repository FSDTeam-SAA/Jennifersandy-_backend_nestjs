import { PartialType, PickType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export const profileFields = [
  'firstName',
  'lastName',
  'gender',
  'phoneNumber',
  'profilePicture',
  'streetAddress',
  'location',
  'bio',
  'postalCode',
] as const;

// Account privileges and recovery credentials must never be self-editable.
export class UpdateProfileDto extends PartialType(
  PickType(CreateUserDto, profileFields),
) {}
