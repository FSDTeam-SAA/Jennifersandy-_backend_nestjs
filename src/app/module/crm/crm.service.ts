import { Injectable } from '@nestjs/common';
import { OnofficeService } from '../onoffice/onoffice.service';

@Injectable()
export class CrmService {
  constructor(private readonly onofficeService: OnofficeService) {}

  syncProducts() {
    return this.onofficeService.syncFromOnOffice();
  }

  syncStatus() {
    return this.onofficeService.getSyncStatus();
  }
}
