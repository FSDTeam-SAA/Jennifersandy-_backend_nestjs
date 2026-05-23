import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpCode,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CrmService } from './crm.service';

import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import AuthGuard from 'src/app/middlewares/auth.guard';
import { SyncOnOfficeProductsDto } from '../product/dto/sync-onoffice-products.dto';
import { UpdateOnOfficeCredentialsDto } from './dto/update-onoffice-credentials.dto';

@ApiTags('crm')
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post('sync/onoffice')
  @ApiOperation({ summary: 'sync onOffice estates into products' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiBody({ type: SyncOnOfficeProductsDto, required: false })
  @HttpCode(HttpStatus.OK)
  async syncProducts(@Body() syncDto: SyncOnOfficeProductsDto) {
    const result = await this.crmService.syncProducts(syncDto);

    return {
      message: 'CRM products synced successfully',
      data: result,
    };
  }

  @Put('onoffice/credentials')
  @ApiOperation({ summary: 'update regenerated onOffice token and secret' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiBody({ type: UpdateOnOfficeCredentialsDto })
  @HttpCode(HttpStatus.OK)
  async updateOnOfficeCredentials(
    @Body() updateOnOfficeCredentialsDto: UpdateOnOfficeCredentialsDto,
  ) {
    const result = await this.crmService.updateOnOfficeCredentials(
      updateOnOfficeCredentialsDto,
    );

    return {
      message: 'onOffice credentials updated successfully',
      data: result,
    };
  }
}
