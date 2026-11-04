import { PartialType } from '@nestjs/swagger';
import { CreateOnofficeDto } from './create-onoffice.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateOnofficeDto extends PartialType(CreateOnofficeDto) {
  @IsOptional()
  @IsBoolean()
  isManuallyHidden?: boolean;
}
