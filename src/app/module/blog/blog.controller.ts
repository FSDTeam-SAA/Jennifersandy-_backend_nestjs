import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UploadedFile,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { BlogService } from './blog.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import AuthGuard from 'src/app/middlewares/auth.guard';
import pick from 'src/app/helpers/pick';
import type { Request } from 'express';
import { fileUpload } from 'src/app/helpers/fileUploder';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Blog')
@Controller('blog')
export class BlogController {
  private readonly auditLogger = new Logger('BlogAudit');
  constructor(private readonly blogService: BlogService) {}

  private auditMutation(action: string, id: string, req: Request) {
    this.auditLogger.warn(JSON.stringify({
      event: 'blog.mutation',
      action,
      blogId: id,
      actorId: req.user?.id,
      actorRole: req.user?.role,
      timestamp: new Date().toISOString(),
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Create a new blog post (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @UseInterceptors(FileInterceptor('thumbnail', fileUpload.uploadConfig))
  @HttpCode(HttpStatus.CREATED)
  async createBlog(
    @Body() createBlogDto: CreateBlogDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const result = await this.blogService.createBlog(createBlogDto, file);
    this.auditMutation('create', String(result._id), req);
    return { message: 'Blog created successfully', data: result };
  }

  @Get()
  @ApiOperation({ summary: 'Get all published blogs (paginated)' })
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'tag', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @HttpCode(HttpStatus.OK)
  async findAllBlogs(@Req() req: Request) {
    const filters = pick(req.query, ['searchTerm', 'category', 'tag']);
    const options = pick(req.query, ['sortBy', 'sortOrder', 'page', 'limit']);
    const result = await this.blogService.findAllBlogs(filters, options);
    return { message: 'Blogs fetched successfully', meta: result.meta, data: result.data };
  }

  // Slug route must come BEFORE :id route
  @Get('admin')
  @ApiOperation({ summary: 'Review all blogs, including drafts and incident evidence (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  async findAllAdminBlogs(@Req() req: Request) {
    const filters = pick(req.query, ['searchTerm', 'category', 'tag']);
    const options = pick(req.query, ['sortBy', 'sortOrder', 'page', 'limit']);
    const result = await this.blogService.findAllBlogs(filters, options, true);
    return { message: 'Blogs fetched successfully', meta: result.meta, data: result.data };
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get blog by slug (SEO-friendly)' })
  @ApiParam({ name: 'slug', type: String })
  @HttpCode(HttpStatus.OK)
  async findBlogBySlug(@Param('slug') slug: string) {
    const result = await this.blogService.findBlogBySlug(slug);
    return { message: 'Blog found successfully', data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blog by MongoDB ID (admin, including drafts)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async findOneBlog(@Param('id') id: string) {
    const result = await this.blogService.findOneBlog(id);
    return { message: 'Blog found successfully', data: result };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a blog post (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @UseInterceptors(FileInterceptor('thumbnail', fileUpload.uploadConfig))
  @HttpCode(HttpStatus.OK)
  async updateBlog(
    @Param('id') id: string,
    @Body() updateBlogDto: UpdateBlogDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const result = await this.blogService.updateBlog(id, updateBlogDto, file);
    this.auditMutation('update', id, req);
    return { message: 'Blog updated successfully', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a blog post (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @Req() req: Request) {
    const result = await this.blogService.removeBlog(id);
    this.auditMutation('delete', id, req);
    return { message: 'Blog deleted successfully', data: result };
  }
}
