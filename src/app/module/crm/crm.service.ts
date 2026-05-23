import { Injectable } from '@nestjs/common';
import fs from 'fs/promises';
import path from 'path';
import { SyncOnOfficeProductsDto } from '../product/dto/sync-onoffice-products.dto';
import { ProductService } from '../product/product.service';
import { UpdateOnOfficeCredentialsDto } from './dto/update-onoffice-credentials.dto';

@Injectable()
export class CrmService {
  constructor(private readonly productService: ProductService) {}

  syncProducts(syncDto: SyncOnOfficeProductsDto) {
    return this.productService.syncFromOnOffice(syncDto);
  }

  async updateOnOfficeCredentials(dto: UpdateOnOfficeCredentialsDto) {
    const estateToken = dto.estateToken ?? dto.token;
    const estateSecret = dto.estateSecret ?? dto.secret;
    const pictureToken = dto.pictureToken ?? dto.token ?? estateToken;
    const pictureSecret = dto.pictureSecret ?? dto.secret ?? estateSecret;

    const updates = {
      ONOFFICE_ESTATE_TOKEN: estateToken,
      ONOFFICE_ESTATE_SECRET: estateSecret,
      ONOFFICE_PICTURE_TOKEN: pictureToken,
      ONOFFICE_PICTURE_SECRET: pictureSecret,
    };

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;

    const envPath = path.join(process.cwd(), '.env');
    let envContent = await fs.readFile(envPath, 'utf8');

    for (const [key, value] of Object.entries(cleanUpdates)) {
      process.env[key] = value;
      envContent = this.upsertEnvValue(envContent, key, value);
    }

    await fs.writeFile(envPath, envContent);

    return {
      updatedKeys: Object.keys(cleanUpdates),
    };
  }

  private upsertEnvValue(content: string, key: string, value: string) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedKey}=.*$`, 'm');
    const line = `${key}=${value}`;

    if (pattern.test(content)) {
      return content.replace(pattern, line);
    }

    return `${content.trimEnd()}\n${line}\n`;
  }
}
