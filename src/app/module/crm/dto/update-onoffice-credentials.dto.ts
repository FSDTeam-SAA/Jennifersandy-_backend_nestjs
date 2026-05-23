import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateOnOfficeCredentialsDto {
  @ApiPropertyOptional({
    description:
      'Use this when one regenerated API token should be used for all onOffice calls.',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description:
      'Use this when one regenerated API secret should be used for all onOffice calls.',
  })
  @IsOptional()
  @IsString()
  secret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estateToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estateSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pictureToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pictureSecret?: string;
}
