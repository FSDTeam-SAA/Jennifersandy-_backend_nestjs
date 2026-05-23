import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OnofficeService {
  constructor(private readonly httpService: HttpService) {}

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

  async getEstatesWithImages(page: number = 0, limit: number = 20) {
    const token = process.env.ONOFFICE_TOKEN || '';
    const secret = process.env.ONOFFICE_SECRET || '';
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
      token,
      'estatepictures',
      imageActionId,
      secret,
    );

    // Step 1: estate list আনো
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
                  'wohnflaeche',
                  'ort',
                  'plz',
                  'strasse',
                  'hausnummer',
                  'objektart',
                  'vermarktungsart',
                  'objektbeschreibung',
                  'lage',
                  'status',
                  'veroeffentlichen',
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
    if (estateResult?.status?.errorcode !== 0) {
      throw new HttpException('Estate fetch failed', 500);
    }

    const estates = estateResult.data.records;
    const total = estateResult.data.meta.cntabsolute;

    // Step 2: estate id গুলো বের করো
    const estateIds = estates.map((e: any) => parseInt(e.id));

    // Step 3: image আনো
    const imageResponse = await firstValueFrom(
      this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
        token,
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

    const imageResult = imageResponse.data?.response?.results?.[0];
    const imageRecords = imageResult?.data?.records || [];

    // Step 4: estate id দিয়ে image map করো
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

    // Step 5: estate + image merge করো
    const merged = estates.map((estate: any) => ({
      id: estate.id,
      ...estate.elements,
      images: imageMap[estate.id] || [],
      titleImage:
        imageMap[estate.id]?.find((img) => img.type === 'Titelbild') || null,
    }));

    return {
      data: merged,
      meta: {
        total,
        page,
        limit,
      },
    };
  }
}
