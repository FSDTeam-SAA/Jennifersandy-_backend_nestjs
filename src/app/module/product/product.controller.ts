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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import pick from 'src/app/helpers/pick';
import AuthGuard from 'src/app/middlewares/auth.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { SyncOnOfficeProductsDto } from './dto/sync-onoffice-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

@ApiTags('product')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @ApiOperation({ summary: 'create product manually' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiBody({ type: CreateProductDto })
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() createProductDto: CreateProductDto) {
    const result = await this.productService.createProduct(createProductDto);

    return {
      message: 'Product created successfully',
      data: result,
    };
  }

  @Post('sync/onoffice')
  @ApiOperation({ summary: 'sync products from onOffice CRM' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiBody({ type: SyncOnOfficeProductsDto, required: false })
  @HttpCode(HttpStatus.OK)
  async syncFromOnOffice(@Body() syncDto: SyncOnOfficeProductsDto) {
    const result = await this.productService.syncFromOnOffice(syncDto);

    return {
      message: 'onOffice products synced successfully',
      data: result,
    };
  }

  @Get()
  @ApiOperation({ summary: 'get all products' })
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  @ApiQuery({ name: 'city', required: false, type: String })
  @ApiQuery({ name: 'postalCode', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async getAllProducts(@Req() req: Request) {
    const filters = pick(req.query, [
      'searchTerm',
      'title',
      'externalNumber',
      'city',
      'postalCode',
      'status',
    ]);
    const options = pick(req.query, ['limit', 'page', 'sortBy', 'sortOrder']);
    const result = await this.productService.getAllProducts(filters, options);

    return {
      message: 'Products retrieved successfully',
      meta: result.meta,
      data: result.data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'get product by id' })
  async getSingleProduct(@Param('id') id: string) {
    const result = await this.productService.getSingleProduct(id);

    return {
      message: 'Product retrieved successfully',
      data: result,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'update product by id' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiBody({ type: UpdateProductDto })
  @HttpCode(HttpStatus.OK)
  async updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    const result = await this.productService.updateProduct(
      id,
      updateProductDto,
    );

    return {
      message: 'Product updated successfully',
      data: result,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'delete product by id' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async deleteProduct(@Param('id') id: string) {
    const result = await this.productService.deleteProduct(id);

    return {
      message: 'Product deleted successfully',
      data: result,
    };
  }
}
