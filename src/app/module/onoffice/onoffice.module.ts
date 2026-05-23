import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OnofficeService } from './onoffice.service';
import { OnofficeController } from './onoffice.controller';

@Module({
  imports: [HttpModule],
  controllers: [OnofficeController],
  providers: [OnofficeService],
})
export class OnofficeModule {}
