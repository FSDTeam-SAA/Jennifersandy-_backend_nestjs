import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SyncOnOfficeProductsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  syncAll?: boolean;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  listLimit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  listOffset?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  maxPages?: number;

  @ApiPropertyOptional({
    default: ['Titelbild', 'Foto', 'Grundriss'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  categories?: string[];

  @ApiPropertyOptional({ default: '800x600' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ default: 'Homepage' })
  @IsOptional()
  @IsString()
  publicationSetting?: string;
}
