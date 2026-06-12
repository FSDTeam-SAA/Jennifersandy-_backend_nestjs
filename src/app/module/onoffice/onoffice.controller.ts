import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OnofficeService } from './onoffice.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import pick from 'src/app/helpers/pick';
import AuthGuard from 'src/app/middlewares/auth.guard';
import { UpdateOnofficeDto } from './dto/update-onoffice.dto';

@ApiTags('onoffice')
@Controller('onoffice')
export class OnofficeController {
  constructor(private readonly onofficeService: OnofficeService) {}

  // ─── Debug: list all available fields in this onOffice account (admin) ─────
  @Get('fields')
  @ApiOperation({ summary: 'List all available estate fields in this onOffice account (admin/debug)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async getAvailableFields() {
    const { fields, defs } = await this.onofficeService.getAvailableEstateFields();
    return { count: fields.length, fields, defs };
  }

  // ─── Map pins (all active properties with coordinates) ──────────────────────
  @Get('estates/map')
  @ApiOperation({ summary: 'Get lightweight map pins for all active estates' })
  @HttpCode(HttpStatus.OK)
  async getMapPins() {
    const data = await this.onofficeService.getMapPins();
    return { message: 'Map pins fetched successfully', data };
  }

  // ─── Popular areas (district aggregation for home page) ─────────────────────
  @Get('popular-areas')
  @ApiOperation({ summary: 'Get property count per district (popular areas)' })
  @HttpCode(HttpStatus.OK)
  async getPopularAreas() {
    const data = await this.onofficeService.getPopularAreas();
    return { message: 'Popular areas fetched successfully', data };
  }

  // ─── Paginated listing with filters ─────────────────────────────────────────
  @Get('estates')
  @ApiOperation({ summary: 'Get all active estates from DB with filters' })
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  @ApiQuery({ name: 'district', required: false, type: String, description: 'Filter by stadtteil (district)' })
  @ApiQuery({ name: 'vermarktungsart', required: false, type: String, description: 'miete | kauf' })
  @ApiQuery({ name: 'objektart', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'minRooms', required: false, type: Number })
  @ApiQuery({ name: 'maxRooms', required: false, type: Number })
  @ApiQuery({ name: 'minPrice', required: false, type: Number, description: 'Min kaltmiete/kaufpreis' })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number, description: 'Max kaltmiete/kaufpreis' })
  @ApiQuery({ name: 'minArea', required: false, type: Number, description: 'Min wohnflaeche m²' })
  @ApiQuery({ name: 'maxArea', required: false, type: Number, description: 'Max wohnflaeche m²' })
  @ApiQuery({ name: 'availableFrom', required: false, type: String, description: 'ISO date — show properties available on or before this date' })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @HttpCode(HttpStatus.OK)
  async getEstates(@Req() req: Request) {
    const filters = pick(req.query, [
      'searchTerm',
      'district',
      'vermarktungsart',
      'objektart',
      'status',
      'minRooms',
      'maxRooms',
      'minPrice',
      'maxPrice',
      'minArea',
      'maxArea',
      'availableFrom',
    ]);
    const options = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
    const result = await this.onofficeService.getEstatesFromDB(filters, options);
    return {
      message: 'Estates fetched successfully',
      meta: result.meta,
      data: result.data,
    };
  }

  // ─── Single estate by slug (details page — SEO-friendly) ────────────────────
  @Get('estates/slug/:slug')
  @ApiOperation({ summary: 'Get single estate by slug (for details page)' })
  @ApiParam({ name: 'slug', type: String })
  @HttpCode(HttpStatus.OK)
  async getEstateBySlug(@Param('slug') slug: string) {
    const result = await this.onofficeService.getEstateBySlug(slug);
    return { message: 'Estate fetched successfully', data: result };
  }

  // ─── Similar estates for a given slug ───────────────────────────────────────
  @Get('estates/slug/:slug/similar')
  @ApiOperation({ summary: 'Get similar estates for a property (by slug)' })
  @ApiParam({ name: 'slug', type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @HttpCode(HttpStatus.OK)
  async getSimilarEstates(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.onofficeService.getSimilarEstates(slug, limit ? parseInt(limit) : 4);
    return { message: 'Similar estates fetched successfully', data };
  }

  // ─── Single estate by onofficeId ────────────────────────────────────────────
  @Get('estates/:id')
  @ApiOperation({ summary: 'Get single estate by onoffice numeric ID' })
  @ApiParam({ name: 'id', type: Number })
  @HttpCode(HttpStatus.OK)
  async getEstateById(@Param('id') id: string) {
    const result = await this.onofficeService.getEstateByOnofficeId(parseInt(id));
    return { message: 'Estate fetched successfully', data: result };
  }

  // ─── Admin: update extra fields (amenities, whyChoose, etc.) ────────────────
  @Patch('estates/:id')
  @ApiOperation({ summary: 'Admin: update extra fields on an estate (amenities, whyChoose, minimumStay, etc.)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async updateEstate(@Param('id') id: string, @Body() updateDto: UpdateOnofficeDto) {
    const result = await this.onofficeService.updateEstate(id, updateDto);
    return { message: 'Estate updated successfully', data: result };
  }
}
