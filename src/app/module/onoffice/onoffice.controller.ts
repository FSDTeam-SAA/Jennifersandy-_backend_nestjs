import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { OnofficeService } from './onoffice.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('onoffice')
@Controller('onoffice')
export class OnofficeController {
  constructor(private readonly onofficeService: OnofficeService) {}

  @Get('estates')
  @ApiOperation({ summary: 'Get all estates with images' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @HttpCode(HttpStatus.OK)
  async getEstates(
    @Query('page') page: number = 0,
    @Query('limit') limit: number = 20,
  ) {
    const result = await this.onofficeService.getEstatesWithImages(
      Number(page),
      Number(limit),
    );
    return {
      message: 'Estates fetched successfully',
      meta: result.meta,
      data: result.data,
    };
  }
}
