import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  Param,
  Req,
} from '@nestjs/common';
import { OnofficeService } from './onoffice.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import pick from 'src/app/helpers/pick';

@ApiTags('onoffice')
@Controller('onoffice')
export class OnofficeController {
  constructor(private readonly onofficeService: OnofficeService) {}

  // DB থেকে fast get
  @Get('estates')
  @ApiOperation({ summary: 'Get all estates from DB (fast)' })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'objekttyp', required: false, type: String })
  @ApiQuery({ name: 'vermarktungsart', required: false, type: String })
  @ApiQuery({ name: 'anzahl_zimmer', required: false, type: Number })
  @ApiQuery({ name: 'anzahl_badezimmer', required: false, type: Number })
  @ApiQuery({ name: 'wohnflaeche', required: false, type: Number })
  @ApiQuery({ name: 'ort', required: false, type: String })
  @ApiQuery({ name: 'plz', required: false, type: Number })
  @ApiQuery({ name: 'strasse', required: false, type: String })
  @ApiQuery({ name: 'hausnummer', required: false, type: String })
  @ApiQuery({ name: 'breitengrad', required: false, type: Number })
  @ApiQuery({ name: 'laengengrad', required: false, type: Number })
  @ApiQuery({ name: 'objektart', required: false, type: String })
  @ApiQuery({ name: 'objektbeschreibung', required: false, type: String })
  @ApiQuery({ name: 'lage', required: false, type: String })
  @ApiQuery({ name: 'veroeffentlichen', required: false, type: String })
  @ApiQuery({ name: 'balkon', required: false, type: String })
  @ApiQuery({ name: 'terrasse', required: false, type: String })
  @ApiQuery({ name: 'fahrstuhl', required: false, type: String })
  @HttpCode(HttpStatus.OK)
  async getEstates(@Req() req: Request) {
    const filters = pick(req.query, [
      'searchTerm',
      'status',
      'objekttyp',
      'vermarktungsart',
      'anzahl_zimmer',
      'anzahl_badezimmer',
      'wohnflaeche',
      'ort',
      'plz',
      'strasse',
      'hausnummer',
      'breitengrad',
      'laengengrad',
      'objektart',
      'objektbeschreibung',
      'lage',
      'veroeffentlichen',
      'balkon',
      'terrasse',
      'fahrstuhl',
    ]);
    const options = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
    const result = await this.onofficeService.getEstatesFromDB(
      filters,
      options,
    );
    return {
      message: 'Estates fetched successfully',
      meta: result.meta,
      data: result.data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single estate from DB by id' })
  @HttpCode(HttpStatus.OK)
  async getSingleEstate(@Param('id') id: string) {
    const result = await this.onofficeService.getSingleEstateFromDB(id);
    return { message: 'Estate fetched successfully', data: result };
  }

  // Single estate by onofficeId
  @Get('estates/:id')
  @ApiOperation({ summary: 'Get single estate by onofficeId' })
  @HttpCode(HttpStatus.OK)
  async getEstateById(@Param('id') id: string) {
    const result = await this.onofficeService.getEstateByIdFromDB(parseInt(id));
    return { message: 'Estate fetched successfully', data: result };
  }
}
