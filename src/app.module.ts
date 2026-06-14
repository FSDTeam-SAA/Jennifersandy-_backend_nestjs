import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import config from './app/config';
import { ContactModule } from './app/module/contact/contact.module';
import { AuthModule } from './app/module/auth/auth.module';
import { UserModule } from './app/module/user/user.module';
import { CrmModule } from './app/module/crm/crm.module';
import { OnofficeModule } from './app/module/onoffice/onoffice.module';
import { InquiryModule } from './app/module/inquiry/inquiry.module';
import { BlogModule } from './app/module/blog/blog.module';
import { LandlordModule } from './app/module/landlord/landlord.module';
import { FaqModule } from './app/module/faq/faq.module';
import { DashboardModule } from './app/module/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(config.mongoUri),
    ScheduleModule.forRoot(),
    UserModule,
    AuthModule,
    ContactModule,
    CrmModule,
    OnofficeModule,
    InquiryModule,
    BlogModule,
    LandlordModule,
    FaqModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
