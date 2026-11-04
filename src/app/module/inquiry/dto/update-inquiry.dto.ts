import { PartialType } from '@nestjs/swagger';
import { CreateInquiryDto } from './create-inquiry.dto';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateInquiryDto extends PartialType(CreateInquiryDto) {
  @IsOptional()
  @IsIn(['new', 'in_progress', 'responded', 'closed'])
  status?: 'new' | 'in_progress' | 'responded' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  responseMessage?: string;
}
