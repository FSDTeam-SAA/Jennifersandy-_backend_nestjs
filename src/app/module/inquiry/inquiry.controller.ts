import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InquiryService } from './inquiry.service';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { UpdateInquiryDto } from './dto/update-inquiry.dto';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import AuthGuard, { OptionalAuthGuard } from 'src/app/middlewares/auth.guard';
import pick from 'src/app/helpers/pick';

@ApiTags('Inquiry')
@Controller('inquiry')
export class InquiryController {
  constructor(private readonly inquiryService: InquiryService) {}

  // Guests AND logged-in users can submit inquiries
  @Post()
  @UseGuards(OptionalAuthGuard())
  @ApiOperation({ summary: 'Submit an inquiry (guests allowed)' })
  @HttpCode(HttpStatus.CREATED)
  async createInquiry(@Req() req: Request, @Body() createInquiryDto: CreateInquiryDto) {
    const userId = req.user?.id;
    const result = await this.inquiryService.createInquiry(createInquiryDto, userId);
    return { message: 'Inquiry submitted successfully', data: result };
  }

  @Get()
  @ApiOperation({ summary: 'Get all inquiries (auth required)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin', 'user'))
  @ApiQuery({ name: 'searchTerm', type: String, required: false })
  @ApiQuery({ name: 'firstName', type: String, required: false })
  @ApiQuery({ name: 'lastName', type: String, required: false })
  @ApiQuery({ name: 'email', type: String, required: false })
  @ApiQuery({ name: 'phoneNumber', type: String, required: false })
  @ApiQuery({ name: 'message', type: String, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'sortBy', type: String, required: false })
  @ApiQuery({ name: 'sortOrder', type: String, required: false })
  @HttpCode(HttpStatus.OK)
  async getAllInquiries(@Req() req: Request) {
    const filters = pick(req.query, ['searchTerm', 'firstName', 'lastName', 'email', 'phoneNumber', 'message']);
    const options = pick(req.query, ['limit', 'page', 'sortBy', 'sortOrder']);
    const result = await this.inquiryService.findAllInquiries(req.user!.id, filters, options);
    return { message: 'Inquiries fetched successfully', data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get inquiry by ID' })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin', 'user'))
  async findInquiryById(@Req() req: Request, @Param('id') id: string) {
    const result = await this.inquiryService.findInquiryById(id, req.user!.id, req.user!.email, req.user!.role);
    return { message: 'Inquiry fetched successfully', data: result };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update inquiry' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async updateInquiry(@Req() req: Request, @Param('id') id: string, @Body() updateInquiryDto: UpdateInquiryDto) {
    const result = await this.inquiryService.updateInquiry(id, updateInquiryDto, req.user!.id, req.user!.email, req.user!.role);
    return { message: 'Inquiry updated successfully', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own inquiry or any inquiry as admin' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin', 'user'))
  @HttpCode(HttpStatus.OK)
  async deleteInquiry(@Req() req: Request, @Param('id') id: string) {
    const result = await this.inquiryService.deleteInquiry(id, req.user!.id, req.user!.email, req.user!.role);
    return { message: 'Inquiry deleted successfully', data: result };
  }
}
