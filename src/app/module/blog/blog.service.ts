import { Injectable, HttpException } from '@nestjs/common';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Blog, BlogDocument } from './entities/blog.entity';
import { fileUpload } from 'src/app/helpers/fileUploder';
import { IFilterParams } from 'src/app/helpers/pick';
import paginationHelper, { IOptions } from 'src/app/helpers/pagenation';

// Confirmed incident marker in the preserved 2026-10-16 evidence snapshot.
// Hide only matching spam from public reads; leave records available to admins.
const incidentMarker = /sitehack\.happening831@passinbox\.com/i;
const publicBlogConditions = () => ({
  isPublished: true,
  $nor: [{ title: incidentMarker }, { excerpt: incidentMarker }, { content: incidentMarker }],
});

@Injectable()
export class BlogService {
  constructor(@InjectModel(Blog.name) private blogModel: Model<BlogDocument>) {}

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 80);
  }

  async createBlog(createBlogDto: CreateBlogDto, file?: Express.Multer.File) {
    if (file) {
      const { url } = await fileUpload.uploadToCloudinary(file);
      createBlogDto.thumbnail = url;
    }

    const slug = this.generateSlug(createBlogDto.title);
    const existing = await this.blogModel.findOne({ slug });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const newBlog = new this.blogModel({
      ...createBlogDto,
      slug: finalSlug,
      publishedAt:
        createBlogDto.isPublished !== false
          ? (createBlogDto.publishedAt ?? new Date())
          : null,
    });
    return newBlog.save();
  }

  async findAllBlogs(params: IFilterParams, options: IOptions, adminView = false) {
    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);

    const conditions: Record<string, any> = adminView ? {} : publicBlogConditions();

    if (params.searchTerm) {
      const regex = new RegExp(
        String(params.searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      conditions.$or = [
        { title: regex },
        { excerpt: regex },
        { content: regex },
      ];
    }

    if (params.category) conditions.category = params.category;
    if (params.tag) conditions.tags = params.tag;

    const [data, total] = await Promise.all([
      this.blogModel
        .find(conditions)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortOrder }),
      this.blogModel.countDocuments(conditions),
    ]);

    return { meta: { page, limit, total }, data };
  }

  async findOneBlog(id: string) {
    const result = await this.blogModel.findById(id);
    if (!result) throw new HttpException('Blog not found', 404);
    return result;
  }

  async findBlogBySlug(slug: string) {
    const result = await this.blogModel.findOne({ slug, ...publicBlogConditions() });
    if (!result) throw new HttpException('Blog not found', 404);
    return result;
  }

  async updateBlog(
    id: string,
    updateBlogDto: UpdateBlogDto,
    file?: Express.Multer.File,
  ) {
    if (file) {
      const { url } = await fileUpload.uploadToCloudinary(file);
      updateBlogDto.thumbnail = url;
    }
    const result = await this.blogModel.findByIdAndUpdate(id, updateBlogDto, {
      new: true,
    });
    if (!result) throw new HttpException('Blog not found', 404);
    return result;
  }

  async removeBlog(id: string) {
    const result = await this.blogModel.findByIdAndDelete(id);
    if (!result) throw new HttpException('Blog not found', 404);
    return result;
  }
}
