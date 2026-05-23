import { PartialType } from '@nestjs/swagger';
import { CreateOnofficeDto } from './create-onoffice.dto';

export class UpdateOnofficeDto extends PartialType(CreateOnofficeDto) {}
