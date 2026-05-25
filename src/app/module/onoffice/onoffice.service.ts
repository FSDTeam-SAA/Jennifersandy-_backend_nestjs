import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Onoffice } from './entities/onoffice.entity';
import { SyncOnOfficeProductsDto } from './dto/syncOnOfficeProducts.dto';
import { IFilterParams } from 'src/app/helpers/pick';
import paginationHelper, { IOptions } from 'src/app/helpers/pagenation';
import buildWhereConditions from 'src/app/helpers/buildWhereConditions';
import { UpdateOnofficeDto } from './dto/update-onoffice.dto';

@Injectable()
export class OnofficeService {
  constructor(
    private readonly httpService: HttpService,
    @InjectModel(Onoffice.name)
    private readonly onofficeModel: Model<Onoffice>,
  ) {}

  private getCredentials() {
    return {
      token:
        process.env.ONOFFICE_ESTATE_TOKEN || process.env.ONOFFICE_TOKEN || '',
      secret:
        process.env.ONOFFICE_ESTATE_SECRET || process.env.ONOFFICE_SECRET || '',
      pictureToken:
        process.env.ONOFFICE_PICTURE_TOKEN || process.env.ONOFFICE_TOKEN || '',
      pictureSecret:
        process.env.ONOFFICE_PICTURE_SECRET ||
        process.env.ONOFFICE_SECRET ||
        '',
    };
  }

  private generateHmac(
    timestamp: number,
    token: string,
    resourceType: string,
    actionId: string,
    secret: string,
  ) {
    return createHmac('sha256', secret)
      .update(timestamp + token + resourceType + actionId)
      .digest('base64');
  }

  // ─── Sync from onOffice & save to DB ───────────────────────────────────────
  async syncFromOnOffice(dto: SyncOnOfficeProductsDto) {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;
    const { token, secret, pictureToken, pictureSecret } =
      this.getCredentials();
    const timestamp = Math.floor(Date.now() / 1000);

    const estateActionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:read';
    const imageActionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:get';

    const estateHmac = this.generateHmac(
      timestamp,
      token,
      'estate',
      estateActionId,
      secret,
    );
    const imageHmac = this.generateHmac(
      timestamp,
      pictureToken,
      'estatepictures',
      imageActionId,
      pictureSecret,
    );

    // Step 1: estates আনো
    const estateResponse = await firstValueFrom(
      this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
        token,
        request: {
          actions: [
            {
              actionid: estateActionId,
              resourceid: '',
              identifier: 'get-estates',
              resourcetype: 'estate',
              timestamp,
              hmac: estateHmac,
              hmac_version: '2',
              parameters: {
                data: [
                  'Id',
                  'objekttitel',
                  'kaltmiete',
                  'warmmiete',
                  'kaufpreis',
                  'anzahl_zimmer',
                  'anzahl_badezimmer',
                  'wohnflaeche',
                  'ort',
                  'plz',
                  'strasse',
                  'hausnummer',
                  'breitengrad',
                  'laengengrad',
                  'objektart',
                  'vermarktungsart',
                  'objektbeschreibung',
                  'lage',
                  'status',
                  'veroeffentlichen',
                  'balkon',
                  'terrasse',
                  'fahrstuhl',
                ],
                listlimit: limit,
                listoffset: page * limit,
              },
            },
          ],
        },
      }),
    );

    const estateResult = estateResponse.data?.response?.results?.[0];
    console.log('Estate API Response:', JSON.stringify(estateResult?.status));

    if (estateResult?.status?.errorcode !== 0) {
      throw new HttpException(
        `Estate fetch failed: ${estateResult?.status?.message} (code: ${estateResult?.status?.errorcode})`,
        500,
      );
    }

    const estates = estateResult.data.records;
    const total = estateResult.data.meta.cntabsolute;
    const estateIds = estates.map((e: any) => parseInt(e.id));

    // Step 2: images আনো
    const imageResponse = await firstValueFrom(
      this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
        token: pictureToken,
        request: {
          actions: [
            {
              actionid: imageActionId,
              resourceid: '',
              identifier: 'get-estate-images',
              resourcetype: 'estatepictures',
              timestamp,
              hmac: imageHmac,
              hmac_version: '2',
              parameters: {
                estateids: estateIds,
                categories: ['Titelbild', 'Foto'],
                size: '800x600',
              },
            },
          ],
        },
      }),
    );

    const imageRecords =
      imageResponse.data?.response?.results?.[0]?.data?.records || [];

    // Step 3: image map
    const imageMap: Record<string, any[]> = {};
    for (const record of imageRecords) {
      const element = record.elements?.[0];
      if (!element) continue;
      const estateId = element.estateid;
      if (!imageMap[estateId]) imageMap[estateId] = [];
      imageMap[estateId].push({
        id: record.id,
        type: element.type,
        url: element.url,
        title: element.title,
      });
    }

    // Step 4: DB upsert
    let synced = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const estate of estates) {
      const el = estate.elements;
      const images = imageMap[estate.id] || [];
      const titleImage = images.find((img) => img.type === 'Titelbild') || null;

      const fahrstuhl = Array.isArray(el.fahrstuhl)
        ? el.fahrstuhl.join(',')
        : String(el.fahrstuhl ?? '');

      try {
        await this.onofficeModel.findOneAndUpdate(
          { onofficeId: parseInt(estate.id) },
          {
            $set: {
              onofficeId: parseInt(estate.id),
              objekttitel: el.objekttitel ?? '',
              objektbeschreibung: el.objektbeschreibung ?? '',
              lage: el.lage ?? '',
              wohnflaeche: el.wohnflaeche ?? '',
              anzahl_zimmer: el.anzahl_zimmer ?? '',
              anzahl_badezimmer: el.anzahl_badezimmer ?? '',
              kaltmiete: el.kaltmiete ?? '',
              warmmiete: el.warmmiete ?? '',
              kaufpreis: el.kaufpreis ?? '',
              vermarktungsart: el.vermarktungsart ?? '',
              objektart: el.objektart ?? '',
              ort: el.ort ?? '',
              plz: el.plz ?? '',
              strasse: el.strasse ?? '',
              hausnummer: el.hausnummer ?? '',
              breitengrad: el.breitengrad ?? '',
              laengengrad: el.laengengrad ?? '',
              balkon: el.balkon ?? '',
              terrasse: el.terrasse ?? '',
              fahrstuhl,
              status: el.status ?? '',
              veroeffentlichen: el.veroeffentlichen ?? '',
              images,
              titleImage,
              syncedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'after' }, // ✅ new: true এর বদলে
        );
        synced++;
      } catch (err: any) {
        errors++;
        errorDetails.push(`ID ${estate.id}: ${err?.message}`);
        console.error(`Upsert failed for estate ${estate.id}:`, err?.message);
      }
    }

    return {
      total,
      synced,
      errors,
      errorDetails,
      page,
      limit,
      syncedAt: new Date(),
    };
  }

  // ─── Get from DB (fast, no API call) ───────────────────────────────────────
  async getEstatesFromDB(params: IFilterParams, options: IOptions) {
    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);
    const whereConditions = buildWhereConditions(params, [
      'objekttitel',
      'objektbeschreibung',
      'lage',
      'wohnflaeche',
      'anzahl_zimmer',
      'anzahl_badezimmer',
      'kaltmiete',
      'warmmiete',
      'kaufpreis',
      'vermarktungsart',
      'objektart',
      'ort',
      'plz',
      'strasse',
      'hausnummer',
      'breitengrad',
      'laengengrad',
      'balkon',
      'terrasse',
      'fahrstuhl',
      'status',
      'veroeffentlichen',
      'availableFrom',
      'minimumStay',
      'deposit',
      'serviceFee',
    ]);
    const [data, total] = await Promise.all([
      this.onofficeModel
        .find(whereConditions)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortOrder } as any),
      this.onofficeModel.countDocuments(whereConditions),
    ]);

    return { data, meta: { total, page, limit } };
  }

  async getSingleEstateFromDB(id: string) {
    const result = await this.onofficeModel.findById(id);
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  async getEstateByIdFromDB(onofficeId: number) {
    const result = await this.onofficeModel.findOne({ onofficeId });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  async updateEstate(id:string, updateEstate:UpdateOnofficeDto){
    const result = await this.onofficeModel.findByIdAndUpdate(id, updateEstate, {new: true});
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }
}
