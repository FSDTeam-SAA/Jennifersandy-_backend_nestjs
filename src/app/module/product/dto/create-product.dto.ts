import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductImageDto {
  @ApiProperty()
  @IsNumber()
  fileId!: number;

  @ApiProperty()
  @IsString()
  estateId!: string;

  @ApiProperty()
  @IsString()
  category!: string;

  @ApiProperty()
  @IsString()
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  modified?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estateMainId?: string;
}

export class CreateProductDto {
  @ApiProperty()
  @IsNumber()
  onOfficeEstateId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  coldRent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  warmRent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  purchasePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  rooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  livingArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ type: [CreateProductImageDto] })
  @IsOptional()
  @IsArray()
  images?: CreateProductImageDto[];
}
