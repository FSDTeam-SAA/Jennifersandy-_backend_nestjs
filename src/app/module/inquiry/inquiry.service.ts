import { HttpException, Injectable } from '@nestjs/common';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { UpdateInquiryDto } from './dto/update-inquiry.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Inquiry, InquiryDocument } from './entities/inquiry.entity';
import { Model } from 'mongoose';
import { User, UserDocument } from '../user/entities/user.entity';
import { IFilterParams } from 'src/app/helpers/pick';
import paginationHelper, { IOptions } from 'src/app/helpers/pagenation';
import buildWhereConditions from 'src/app/helpers/buildWhereConditions';
import { Onoffice, OnofficeDocument } from '../onoffice/entities/onoffice.entity';
import sendMailer from 'src/app/helpers/sendMailer';

@Injectable()
export class InquiryService {
  constructor(
    @InjectModel(Inquiry.name)
    private readonly inquiryModel: Model<InquiryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Onoffice.name)
    private readonly onofficeModel: Model<OnofficeDocument>,
  ) {}

  // Guests can submit inquiries (userId is optional)
  async createInquiry(createInquiryDto: CreateInquiryDto, userId?: string) {
    const onoffice = await this.onofficeModel.findById(createInquiryDto.onOfficeId);
    if (!onoffice) throw new HttpException('Property not found', 404);

    const inquiry = await this.inquiryModel.create({
      ...createInquiryDto,
      ...(userId ? { user: userId } : {}),
    });
    return inquiry;
  }

  private ownsInquiry(inquiry: InquiryDocument, userId: string, email: string, role: string) {
    return role === 'admin' ||
      inquiry.user?.toString() === userId ||
      (!inquiry.user && inquiry.email.toLowerCase() === email.toLowerCase());
  }

  async updateInquiry(id: string, updateInquiryDto: UpdateInquiryDto, userId: string, email: string, role: string) {
    const inquiry = await this.inquiryModel.findById(id);
    if (!inquiry) throw new HttpException('Inquiry not found', 404);
    if (!this.ownsInquiry(inquiry, userId, email, role)) {
      throw new HttpException('Forbidden', 403);
    }
    if (updateInquiryDto.status === 'responded') {
      const responseMessage = updateInquiryDto.responseMessage?.trim();
      if (!responseMessage) throw new HttpException('A response message is required', 400);
      await sendMailer(inquiry.email, 'Antwort auf Ihre Wohnungsanfrage — 0211wohnen', `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#262626">
          <h2>Ihre Anfrage bei 0211wohnen</h2>
          <p>Hallo ${inquiry.firstName},</p>
          <p>${responseMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          <p>Freundliche Grüße<br/>Ihr 0211wohnen Team</p>
        </div>`);
      updateInquiryDto.responseMessage = responseMessage;
    }
    const updated = await this.inquiryModel.findByIdAndUpdate(id, {
      ...updateInquiryDto,
      ...(updateInquiryDto.status === 'responded' ? { respondedAt: new Date() } : {}),
    }, { new: true, runValidators: true });
    return updated;
  }

  async findAllInquiries(userId: string, params: IFilterParams, options: IOptions) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new HttpException('User not found', 404);

    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);
    const extraConditions = user.role !== 'admin'
      ? {
          $or: [
            { user: user._id },
            {
              user: { $exists: false },
              email: { $regex: `^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
            },
          ],
        }
      : {};

    const whereConditions = buildWhereConditions(
      params,
      ['firstName', 'lastName', 'email', 'phoneNumber', 'message'],
      extraConditions,
    );

    const [inquiries, total] = await Promise.all([
      this.inquiryModel
        .find(whereConditions)
        .populate('user', 'firstName lastName email phoneNumber')
        .populate('onOfficeId', 'objekttitel slug wohnflaeche anzahl_zimmer images titleImage price priceLabel rentalStatusLabel verfuegbarAbText')
        .sort({ [sortBy || 'createdAt']: sortOrder || 'desc' })
        .skip(skip)
        .limit(limit),
      this.inquiryModel.countDocuments(whereConditions),
    ]);

    return { data: inquiries, meta: { page, limit, total } };
  }

  async findInquiryById(id: string, userId: string, email: string, role: string) {
    const inquiry = await this.inquiryModel.findById(id);
    if (!inquiry) throw new HttpException('Inquiry not found', 404);
    if (!this.ownsInquiry(inquiry, userId, email, role)) {
      throw new HttpException('Forbidden', 403);
    }
    return inquiry;
  }

  async deleteInquiry(id: string, userId: string, email: string, role: string) {
    const inquiry = await this.inquiryModel.findById(id);
    if (!inquiry) throw new HttpException('Inquiry not found', 404);
    if (!this.ownsInquiry(inquiry, userId, email, role)) {
      throw new HttpException('Forbidden', 403);
    }
    await this.inquiryModel.findByIdAndDelete(id);
    return { message: 'Inquiry deleted successfully' };
  }
}
