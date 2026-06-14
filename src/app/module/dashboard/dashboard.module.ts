import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../user/entities/user.entity';
import { Payment, PaymentSchema } from '../payment/entities/payment.entity';
import { Onoffice, OnofficeSchema } from '../onoffice/entities/onoffice.entity';
import { Inquiry, InquirySchema } from '../inquiry/entities/inquiry.entity';
import { Blog, BlogSchema } from '../blog/entities/blog.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Onoffice.name, schema: OnofficeSchema },
      { name: Inquiry.name, schema: InquirySchema },
      { name: Blog.name, schema: BlogSchema }
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
