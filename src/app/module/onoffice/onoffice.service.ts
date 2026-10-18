import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Onoffice } from './entities/onoffice.entity';
import type { IFilterParams } from '../../helpers/pick';
import paginationHelper, { type IOptions } from '../../helpers/pagenation';
import { UpdateOnofficeDto } from './dto/update-onoffice.dto';

@Injectable()
export class OnofficeService {
  // Cached field definitions from onOffice (populated once per sync)
  private fieldDefs: Record<string, any> = {};
  private syncInProgress = false;

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

  private allowedMarketingStatuses(): string[] | null {
    const setting = process.env.ONOFFICE_ALLOWED_MARKETING_STATUSES;
    if (setting?.trim() === '*') return null;
    // Verified VENTOS account labels: IN VERMIETUNG, IM VERKAUF.
    const statuses = (setting ?? 'ind_Schl_2897,status2obj_aktiv')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!statuses.length)
      throw new HttpException('onOffice marketing status policy is empty', 503);
    return statuses;
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

  private generateSlug(title: string, id: number): string {
    const base = (title || `property-${id}`)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 60);
    return `${base}-${id}`;
  }

  private toNum(val: any): number {
    if (val == null || val === '') return 0;
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  // Any value (including arrays) → safe string
  private toStr(val: any): string {
    if (val == null || val === '') return '';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  // Strip leading/trailing asterisks (*), markdown formatting, and decorative symbols from titles
  cleanTitle(title: string): string {
    if (!title) return '';
    return title
      .replace(/\*+/g, ' ')
      .replace(/^[\s#!~=\-_–—•·|:]+/, '')
      .replace(/[\s#!~=\-_–—•·|:]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Translate onOffice internal key(s) → human-readable label using permittedvalues
  private resolveLabel(fieldName: string, value: any, formatted?: any): string {
    if (value == null || value === '') return '';
    if (fieldName === 'status' && !this.fieldDefs.status) {
      return { '1': 'Aktiv', '0': 'Inaktiv' }[String(value)] ?? '';
    }
    const arr = Array.isArray(value) ? value : [value];
    const permitted: Record<string, string> =
      this.fieldDefs[fieldName]?.permittedvalues ?? {};
    const definition = this.fieldDefs[fieldName];
    if (
      ['singleselect', 'multiselect'].includes(definition?.type) &&
      !Object.keys(permitted).length
    ) {
      // Regional selections may have no dictionary; ask onOffice to format those fields separately.
      if (
        formatted == null ||
        JSON.stringify(formatted) === JSON.stringify(value)
      )
        return '';
      const label = this.toStr(formatted);
      return /(?:indMulti\d+Select\d+|ind_Schl_\d+|openGeoDb_\w+)/.test(label)
        ? ''
        : label;
    }
    return arr
      .map((k) => {
        if (permitted[k] != null) return permitted[k];
        if (definition?.type === 'boolean' || typeof k === 'boolean') {
          return this.toBoolean(k) ? 'Ja' : 'Nein';
        }
        // Unknown select codes must never become customer-facing content.
        return ['singleselect', 'multiselect'].includes(definition?.type)
          ? ''
          : String(k);
      })
      .filter(Boolean)
      .join(', ');
  }

  private toBoolean(value: any): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  private getPrice(el: Record<string, any>) {
    const marketing = this.toStr(el.vermarktungsart).toLowerCase();
    const allInclusive = this.toNum(el.miete_pauschal);
    const warmRent = this.toNum(el.warmmiete);
    const rent = warmRent > 0 ? warmRent : this.toNum(el.kaltmiete);
    const purchase = this.toNum(el.kaufpreis);
    if (marketing === 'kauf') {
      return {
        price: purchase > 0 ? purchase : null,
        priceType: 'purchase',
        pricePeriod: null,
        priceLabel: 'Kaufpreis',
      };
    }
    if (marketing === 'miete') {
      if (allInclusive > 0) {
        const period =
          { T: 'day', W: 'week', M: 'month' }[el.miete_pauschal_pro] ?? null;
        return {
          price: allInclusive,
          priceType: 'rent',
          pricePeriod: period,
          priceLabel: 'Pauschalmiete',
        };
      }
      return {
        price: rent > 0 ? rent : null,
        priceType: 'rent',
        pricePeriod: 'month',
        priceLabel: this.toNum(el.warmmiete) > 0 ? 'Warmmiete' : 'Kaltmiete',
      };
    }
    return {
      price: null,
      priceType: 'unknown',
      pricePeriod: null,
      priceLabel: '',
    };
  }

  private getRentalStatus(el: Record<string, any>) {
    const code = this.toStr(el.ind_1768_Feld_ObjKategorie10);
    const label = this.resolveLabel('ind_1768_Feld_ObjKategorie10', code);
    if (code && label) {
      const occupancy =
        {
          ind_Schl_2907: 'vacant',
          ind_Schl_2905: 'partially_vacant',
          ind_Schl_2909: 'rented',
        }[code] ?? 'unknown';
      return { rentalStatus: occupancy, rentalStatusLabel: label };
    }
    if (this.toBoolean(el.verkauft)) {
      return el.vermarktungsart === 'kauf'
        ? { rentalStatus: 'sold', rentalStatusLabel: 'Verkauft' }
        : { rentalStatus: 'rented', rentalStatusLabel: 'Vermietet' };
    }
    return this.toBoolean(el.reserviert)
      ? { rentalStatus: 'reserved', rentalStatusLabel: 'Reserviert' }
      : { rentalStatus: 'available', rentalStatusLabel: 'Verfügbar' };
  }

  private parseAvailability(value: any): Date | null {
    const text = this.toStr(value);
    const germanDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    const iso = germanDate
      ? `${germanDate[3]}-${germanDate[2]}-${germanDate[1]}`
      : text;
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(iso)) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Load field definitions from onOffice and cache them in this.fieldDefs
  private async loadFieldDefinitions(): Promise<string[]> {
    const { token, secret } = this.getCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const actionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:get';
    const hmac = this.generateHmac(
      timestamp,
      token,
      'fields',
      actionId,
      secret,
    );

    const res = await firstValueFrom(
      this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
        token,
        request: {
          actions: [
            {
              actionid: actionId,
              resourceid: '',
              identifier: 'get-fields',
              resourcetype: 'fields',
              timestamp,
              hmac,
              hmac_version: '2',
              parameters: {
                modules: ['estate'],
                labels: true,
                language: 'DEU',
              },
            },
          ],
        },
      }),
    );

    const result = res.data?.response?.results?.[0];
    if (
      result?.status?.errorcode !== 0 ||
      !Array.isArray(result?.data?.records)
    ) {
      throw new HttpException(
        'Unable to load onOffice field definitions; sync cancelled',
        502,
      );
    }
    const records = result.data.records;
    const estateModule = records.find((r: any) => r.id === 'estate');
    if (!estateModule?.elements || !Object.keys(estateModule.elements).length) {
      throw new HttpException(
        'No estate field definitions received; sync cancelled',
        502,
      );
    }
    this.fieldDefs = estateModule.elements;
    return Object.keys(this.fieldDefs);
  }

  // ─── Auto sync every 10 minutes ─────────────────────────────────────────────
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoSync() {
    console.log('[AutoSync] Starting scheduled onOffice sync...');
    try {
      const result = await this.fullSync();
      console.log(
        `[AutoSync] Done — synced: ${result.synced}, deactivated: ${result.deactivated}`,
      );
    } catch (err: any) {
      console.error('[AutoSync] Failed:', err?.message);
    }
  }

  // ─── Get all available estate fields (also used by debug endpoint) ──────────
  async getAvailableEstateFields(): Promise<{
    fields: string[];
    defs: Record<string, any>;
  }> {
    const fields = await this.loadFieldDefinitions();
    return { fields, defs: this.fieldDefs };
  }

  // ─── Full sync: fetches ALL properties in one call ──────────────────────────
  async fullSync() {
    if (this.syncInProgress)
      throw new HttpException('An onOffice sync is already running', 409);
    this.syncInProgress = true;
    try {
      return await this.performFullSync();
    } finally {
      this.syncInProgress = false;
    }
  }

  private async performFullSync() {
    const { token, secret, pictureToken, pictureSecret } =
      this.getCredentials();
    if (!token || !secret || !pictureToken || !pictureSecret) {
      throw new HttpException(
        'onOffice API credentials are not configured',
        503,
      );
    }
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

    // Step 0: load field definitions (populates this.fieldDefs + returns available keys)
    const availableFields = await this.loadFieldDefinitions();

    const desiredFields = [
      'Id',
      'objekttitel',
      'objektart',
      'objekttyp',
      'kaltmiete',
      'warmmiete',
      'miete_pauschal',
      'miete_pauschal_pro',
      'kaufpreis',
      'kaution',
      'nebenkosten',
      'anzahl_zimmer',
      'anzahl_badezimmer',
      'anzahl_schlafzimmer',
      'wohnflaeche',
      'ort',
      'plz',
      'strasse',
      'hausnummer',
      'stadtteil',
      'regionaler_zusatz', // both — whichever exists
      'breitengrad',
      'laengengrad',
      'objektbeschreibung',
      'lage',
      'ausstatt_beschr',
      'vermarktungsart',
      'status',
      'status2',
      'veroeffentlichen',
      'showGoogleMap',
      'verfuegbar_ab',
      'abdatum',
      'verkauft',
      'reserviert',
      'ind_1768_Feld_ObjKategorie10',
      'balkon',
      'terrasse',
      'fahrstuhl',
      'moebliert',
      'haustiere',
    ];

    // These documented special fields are readable even when omitted from the account's field definitions.
    const specialFields = [
      'Id',
      'status',
      'veroeffentlichen',
      'showGoogleMap',
      'verkauft',
      'reserviert',
    ];
    const allowedStatuses = this.allowedMarketingStatuses();
    if (allowedStatuses && !availableFields.includes('status2')) {
      throw new HttpException(
        'Marketing status configuration is unavailable; sync cancelled',
        502,
      );
    }
    const data = desiredFields.filter(
      (f) => specialFields.includes(f) || availableFields.includes(f),
    );
    const formattedFields = data.filter(
      (field) =>
        ['singleselect', 'multiselect'].includes(this.fieldDefs[field]?.type) &&
        !Object.keys(this.fieldDefs[field]?.permittedvalues ?? {}).length,
    );

    const missing = desiredFields.filter(
      (f) => !specialFields.includes(f) && !availableFields.includes(f),
    );
    if (missing.length) {
      console.warn(
        '[Sync] Fields not available in this onOffice account, skipped:',
        missing.join(', '),
      );
    }

    // Fetch every page before changing stored publication state.
    const estates: any[] = [];
    let total = 0;
    let cursor = 0;
    do {
      const parameters = {
        data,
        listlimit: 500,
        filter: {
          veroeffentlichen: [{ op: '=', val: 1 }],
          status: [{ op: '=', val: 1 }],
          ...(allowedStatuses
            ? { status2: [{ op: 'IN', val: allowedStatuses }] }
            : {}),
          ...(cursor ? { Id: [{ op: '>', val: cursor }] } : {}),
        },
        sortby: { Id: 'ASC' },
        estatelanguage: 'DEU',
      };
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
                parameters,
              },
            ],
          },
        }),
      );

      const estateResult = estateResponse.data?.response?.results?.[0];
      if (
        estateResult?.status?.errorcode !== 0 ||
        !Array.isArray(estateResult?.data?.records)
      ) {
        throw new HttpException(
          `Estate fetch failed: ${estateResult?.status?.message} (code: ${estateResult?.status?.errorcode})`,
          500,
        );
      }

      const page = estateResult.data.records as any[];
      if (cursor === 0) {
        const count = estateResult.data.meta?.cntabsolute;
        if (count == null || count === '')
          throw new HttpException(
            'Missing onOffice result count; sync cancelled',
            502,
          );
        total = Number(count);
      }
      if (!Number.isFinite(total) || total < 0) {
        throw new HttpException(
          'Incomplete onOffice estate response; sync cancelled',
          502,
        );
      }
      for (const estate of page) {
        if (
          !Number.isInteger(Number(estate.id)) ||
          Number(estate.id) <= cursor ||
          !this.toBoolean(estate.elements?.veroeffentlichen) ||
          Number(estate.elements?.status) !== 1 ||
          (allowedStatuses &&
            !allowedStatuses.includes(estate.elements?.status2))
        ) {
          throw new HttpException(
            'Unexpected onOffice publication data; sync cancelled',
            502,
          );
        }
      }
      if (page.length && formattedFields.length) {
        const labelsResponse = await firstValueFrom(
          this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
            token,
            request: {
              actions: [
                {
                  actionid: estateActionId,
                  resourceid: '',
                  identifier: 'get-estate-labels',
                  resourcetype: 'estate',
                  timestamp,
                  hmac: estateHmac,
                  hmac_version: '2',
                  parameters: {
                    ...parameters,
                    data: ['Id', ...formattedFields],
                    formatoutput: true,
                    outputlanguage: 'DEU',
                  },
                },
              ],
            },
          }),
        );
        const labelsResult = labelsResponse.data?.response?.results?.[0];
        const labelRecords = labelsResult?.data?.records;
        if (
          labelsResult?.status?.errorcode !== 0 ||
          !Array.isArray(labelRecords) ||
          labelRecords.length !== page.length ||
          labelRecords.some(
            (record, index) => Number(record.id) !== Number(page[index].id),
          )
        ) {
          throw new HttpException(
            'Unable to resolve onOffice selection labels; sync cancelled',
            502,
          );
        }
        page.forEach((estate, index) => {
          estate.labels = labelRecords[index].elements;
        });
      }
      estates.push(...page);
      if (page.length < 500) break;
      const nextCursor = Number(page[page.length - 1].id);
      if (nextCursor <= cursor)
        throw new HttpException('onOffice pagination did not advance', 502);
      cursor = nextCursor;
    } while (true);
    if (
      estates.length !== total ||
      new Set(estates.map((e) => Number(e.id))).size !== estates.length
    ) {
      throw new HttpException(
        'onOffice result changed or was incomplete; sync cancelled',
        502,
      );
    }
    const estateIds = estates.map((e: any) => parseInt(e.id));

    // Step 2: fetch images for all estates
    const imageRecords: any[] = [];
    for (let offset = 0; offset < estateIds.length; offset += 100) {
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
                  estateids: estateIds.slice(offset, offset + 100),
                  categories: ['Titelbild', 'Foto', 'Grundriss'],
                },
              },
            ],
          },
        }),
      );

      const imageResult = imageResponse.data?.response?.results?.[0];
      if (
        imageResult?.status?.errorcode !== 0 ||
        !Array.isArray(imageResult?.data?.records)
      ) {
        throw new HttpException(
          'Unable to load onOffice images; sync cancelled',
          502,
        );
      }
      imageRecords.push(...imageResult.data.records);
    }
    const imageMap: Record<string, any[]> = {};
    for (const record of imageRecords) {
      const elements = Array.isArray(record.elements)
        ? record.elements
        : [record.elements];
      for (const element of elements) {
        if (!element?.estateid || !element.url) continue;
        const estId = element.estateid;
        if (!imageMap[estId]) imageMap[estId] = [];
        imageMap[estId].push({
          id: record.id,
          type: element.type,
          url: element.url,
          title: element.title,
        });
      }
    }

    // Step 3: upsert into MongoDB
    let synced = 0;
    let errors = 0;

    for (const estate of estates) {
      const el = estate.elements;
      const id = parseInt(estate.id);
      const images = imageMap[estate.id] || [];
      const titleImage =
        images.find((img) => img.type === 'Titelbild') || images[0] || null;
      const label = (field: string) =>
        this.resolveLabel(field, el[field], estate.labels?.[field]);

      const verfuegbar =
        this.parseAvailability(el.abdatum) ??
        this.parseAvailability(el.verfuegbar_ab);

      try {
        await this.onofficeModel.findOneAndUpdate(
          { onofficeId: id },
          {
            $set: {
              onofficeId: id,
              slug: this.generateSlug(this.cleanTitle(this.toStr(el.objekttitel)), id),
              objekttitel: this.cleanTitle(this.toStr(el.objekttitel)),
              objektbeschreibung: this.toStr(el.objektbeschreibung),
              lage: this.toStr(el.lage),
              ausstatt_beschr: this.toStr(el.ausstatt_beschr),
              wohnflaeche: this.toNum(el.wohnflaeche),
              anzahl_zimmer: this.toNum(el.anzahl_zimmer),
              anzahl_badezimmer: this.toNum(el.anzahl_badezimmer),
              anzahl_schlafzimmer: this.toNum(el.anzahl_schlafzimmer),
              kaltmiete: this.toNum(el.kaltmiete),
              warmmiete: this.toNum(el.warmmiete),
              miete_pauschal: this.toNum(el.miete_pauschal),
              miete_pauschal_pro: this.toStr(el.miete_pauschal_pro),
              mietePauschalProLabel: label('miete_pauschal_pro'),
              kaufpreis: this.toNum(el.kaufpreis),
              kaution: this.toNum(el.kaution),
              nebenkosten: this.toNum(el.nebenkosten),
              // Select/multiselect fields — translate internal keys to labels
              vermarktungsart: this.toStr(el.vermarktungsart),
              vermarktungsartLabel: label('vermarktungsart'),
              objektart: this.toStr(el.objektart),
              objektartLabel: label('objektart'),
              objekttyp: this.toStr(el.objekttyp),
              objekttypLabel: label('objekttyp'),
              status: this.toStr(el.status),
              statusLabel: label('status'),
              status2: this.toStr(el.status2),
              status2Label: label('status2'),
              rentalStatusCode: this.toStr(el.ind_1768_Feld_ObjKategorie10),
              verkauft: this.toBoolean(el.verkauft),
              reserviert: this.toBoolean(el.reserviert),
              ...this.getRentalStatus(el),
              ...this.getPrice(el),
              balkon: label('balkon'),
              terrasse: label('terrasse'),
              fahrstuhl: label('fahrstuhl'),
              moebliert: label('moebliert'),
              haustiere: label('haustiere'),
              veroeffentlichen: '1',
              showGoogleMap: this.toBoolean(el.showGoogleMap),
              // District: try stadtteil first, then regionaler_zusatz (both with label resolution)
              stadtteil: this.resolveDistrictName(el),
              ort: this.toStr(el.ort),
              plz: this.toStr(el.plz),
              strasse: this.toStr(el.strasse),
              hausnummer: this.toStr(el.hausnummer),
              breitengrad: el.breitengrad ? this.toNum(el.breitengrad) : null,
              laengengrad: el.laengengrad ? this.toNum(el.laengengrad) : null,
              verfuegbar_ab: verfuegbar,
              verfuegbarAbText: this.toStr(el.verfuegbar_ab),
              images,
              titleImage,
              isActive: true,
              syncedAt: new Date(),
            },
          },
          { upsert: true },
        );
        synced++;
      } catch (err: any) {
        errors++;
        console.error(`Upsert failed for estate ${estate.id}:`, err?.message);
      }
    }

    // Step 4: deactivate only if sync succeeded — guard against wiping DB on API failure
    let deactivated = 0;
    if (errors === 0) {
      const r = await this.onofficeModel.updateMany(
        { onofficeId: { $nin: estateIds }, isActive: true },
        { $set: { isActive: false } },
      );
      deactivated = r.modifiedCount;
    } else {
      console.warn(
        '[Sync] Partial write failure — skipping deactivation to protect existing data.',
      );
    }

    return {
      total,
      synced,
      errors,
      deactivated,
      complete: errors === 0,
      syncedAt: new Date(),
    };
  }

  // ─── Manual sync endpoint (admin) — delegates to fullSync ───────────────────
  async syncFromOnOffice() {
    return this.fullSync();
  }

  async getSyncStatus() {
    const [total, latest] = await Promise.all([
      this.onofficeModel.countDocuments(this.publishedConditions()),
      this.onofficeModel
        .findOne()
        .sort({ syncedAt: -1 })
        .select('syncedAt')
        .lean(),
    ]);
    return {
      total,
      syncedAt: latest?.syncedAt ?? null,
      syncInProgress: this.syncInProgress,
    };
  }

  private resolveDistrictName(el: Record<string, any>): string {
    const code = this.toStr(el.stadtteil);
    const CODE_MAP: Record<string, string> = {
      indMulti1978Select5917: 'Düsseltal',
      indMulti1978Select5919: 'Flingern',
      indMulti1978Select5921: 'Düsseltal',
      indMulti1978Select5923: 'Friedrichstadt',
      indMulti1978Select5927: 'Medienhafen',
      indMulti1978Select5929: 'Gerresheim',
      indMulti1978Select5933: 'Oberbilk',
      indMulti1978Select5935: 'Pempelfort',
      indMulti1978Select5937: 'Stadtmitte',
      indMulti1978Select5939: 'Rath',
      indMulti1978Select5941: 'Unterbilk',
      openGeoDb_Region_112745: 'Bilk',
      openGeoDb_Region_112746: 'Derendorf',
      openGeoDb_Region_112748: 'Flehe',
      openGeoDb_Region_112750: 'Golzheim',
      openGeoDb_Region_112752: 'Hamm',
      openGeoDb_Region_112753: 'Hassels',
      openGeoDb_Region_112754: 'Heerdt',
      openGeoDb_Region_112771: 'Unterbach',
      openGeoDb_Region_112772: 'Unterrath',
      openGeoDb_Region_112773: 'Urdenbach',
      openGeoDb_Region_112776: 'Wersten',
    };
    if (el.plz === '40213' || /carlstadt/i.test(this.toStr(el.lage) + ' ' + this.toStr(el.objekttitel))) {
      return 'Carlstadt';
    }
    if (/medienhafen/i.test(this.toStr(el.lage) + ' ' + this.toStr(el.objekttitel))) {
      return 'Medienhafen';
    }
    if (CODE_MAP[code]) return CODE_MAP[code];
    const resolved = this.resolveLabel('stadtteil', code) || this.resolveLabel('regionaler_zusatz', el.regionaler_zusatz);
    if (resolved && !/(?:indMulti|ind_Schl_|openGeoDb)/.test(resolved)) return resolved;
    const ortMatch = this.toStr(el.ort).match(/Düsseldorf\s*\/\s*(.+)/i);
    if (ortMatch && ortMatch[1]) {
      const sub = ortMatch[1].trim();
      return /flingern/i.test(sub) ? 'Flingern' : sub;
    }
    if (el.plz === '40219') return 'Unterbilk';
    if (el.plz === '40477') return 'Pempelfort';
    if (el.plz === '40223') return 'Bilk';
    if (el.plz === '40215') return 'Friedrichstadt';
    if (el.plz === '40476') return 'Derendorf';
    if (el.plz === '40211') return 'Stadtmitte';
    return '';
  }

  private publishedConditions(): Record<string, any> {
    const statuses = this.allowedMarketingStatuses();
    return {
      isActive: true,
      ...(statuses ? { status2: { $in: statuses } } : {}),
    };
  }

  private buildEstateConditions(params: IFilterParams = {}) {
    const conditions = this.publishedConditions();
    const and: Record<string, any>[] = [];
    const literalRegex = (value: any) =>
      new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const range = (min: any, max: any) => {
      const result: Record<string, number> = {};
      for (const [key, value] of [
        ['$gte', min],
        ['$lte', max],
      ]) {
        if (value === undefined || value === '') continue;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0)
          throw new HttpException('Invalid numeric filter', 400);
        result[key] = number;
      }
      if (
        result.$gte != null &&
        result.$lte != null &&
        result.$gte > result.$lte
      ) {
        throw new HttpException('Filter minimum cannot exceed maximum', 400);
      }
      return result;
    };

    if (params.searchTerm) {
      const regex = literalRegex(params.searchTerm);
      and.push({
        $or: [
          'objekttitel',
          'objektbeschreibung',
          'lage',
          'ort',
          'stadtteil',
        ].map((field) => ({ [field]: regex })),
      });
    }
    if (params.district) {
      const d = String(params.district).trim();
      if (/medienhafen/i.test(d)) {
        and.push({
          $or: [
            { stadtteil: /Medienhafen|Hafen|Unterbilk/i },
            { lage: /Medienhafen/i },
            { objekttitel: /Medienhafen/i },
          ],
        });
      } else if (/carlstadt/i.test(d)) {
        and.push({
          $or: [
            { stadtteil: /Carlstadt/i },
            { lage: /Carlstadt/i },
            { plz: '40213' },
          ],
        });
      } else {
        conditions.stadtteil = literalRegex(d);
      }
    }
    if (params.vermarktungsart) {
      if (!['miete', 'kauf'].includes(String(params.vermarktungsart)))
        throw new HttpException('Invalid marketing type', 400);
      conditions.vermarktungsart = params.vermarktungsart;
    }
    if (params.objektart) conditions.objektart = String(params.objektart);
    if (params.status) conditions.status = String(params.status);

    const rooms = range(params.minRooms, params.maxRooms);
    if (Object.keys(rooms).length) conditions.anzahl_zimmer = rooms;
    const area = range(params.minArea, params.maxArea);
    if (Object.keys(area).length) conditions.wohnflaeche = area;
    const price = range(params.minPrice, params.maxPrice);
    if (Object.keys(price).length) {
      // Match the displayed price: purchase for sales; warm/cold rent for rentals.
      const priceExpression = {
        $switch: {
          branches: [
            { case: { $eq: ['$vermarktungsart', 'kauf'] }, then: '$kaufpreis' },
            {
              case: { $eq: ['$vermarktungsart', 'miete'] },
              then: {
                $cond: [
                  { $gt: ['$miete_pauschal', 0] },
                  '$miete_pauschal',
                  {
                    $cond: [
                      { $gt: ['$warmmiete', 0] },
                      '$warmmiete',
                      '$kaltmiete',
                    ],
                  },
                ],
              },
            },
          ],
          default: 0,
        },
      };
      and.push({
        $expr: {
          $and: [
            { $gt: [priceExpression, 0] },
            ...(price.$gte != null
              ? [{ $gte: [priceExpression, price.$gte] }]
              : []),
            ...(price.$lte != null
              ? [{ $lte: [priceExpression, price.$lte] }]
              : []),
          ],
        },
      });
    }
    if (params.availableFrom) {
      const date = this.parseAvailability(params.availableFrom);
      if (!date) throw new HttpException('Invalid availability date', 400);
      conditions.verfuegbar_ab = { $ne: null, $lte: date };
    }
    if (and.length) conditions.$and = and;
    return conditions;
  }

  // ─── Get paginated list from DB ──────────────────────────────────────────────
  async getEstatesFromDB(params: IFilterParams, options: IOptions) {
    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);

    const conditions = this.buildEstateConditions(params);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isInteger(page) ||
      page < 1
    ) {
      throw new HttpException('Invalid pagination (limit must be 1–1000)', 400);
    }

    const [data, total] = await Promise.all([
      this.onofficeModel
        .find(conditions)
        .skip(skip)
        .limit(limit)
        .sort({ [sortBy]: sortOrder } as any),
      this.onofficeModel.countDocuments(conditions),
    ]);

    return { data, meta: { total, page, limit } };
  }

  // ─── Single estate by MongoDB _id ───────────────────────────────────────────
  async getSingleEstateFromDB(id: string) {
    const result = await this.onofficeModel.findOne({
      _id: id,
      ...this.publishedConditions(),
    });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Single estate by slug ───────────────────────────────────────────────────
  async getEstateBySlug(slug: string) {
    const result = await this.onofficeModel.findOne({
      slug,
      ...this.publishedConditions(),
    });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Single estate by onofficeId ────────────────────────────────────────────
  async getEstateByOnofficeId(onofficeId: number) {
    const result = await this.onofficeModel.findOne({
      onofficeId,
      ...this.publishedConditions(),
    });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Map pins: lightweight payload for all active properties ────────────────
  async getMapPins(params: IFilterParams = {}) {
    return this.onofficeModel
      .find(
        {
          ...this.buildEstateConditions(params),
          showGoogleMap: true,
          breitengrad: { $gte: -90, $lte: 90, $ne: null },
          laengengrad: { $gte: -180, $lte: 180, $ne: null },
        },
        {
          _id: 1,
          slug: 1,
          objekttitel: 1,
          kaltmiete: 1,
          kaufpreis: 1,
          warmmiete: 1,
          miete_pauschal: 1,
          miete_pauschal_pro: 1,
          mietePauschalProLabel: 1,
          vermarktungsart: 1,
          vermarktungsartLabel: 1,
          price: 1,
          priceType: 1,
          pricePeriod: 1,
          priceLabel: 1,
          rentalStatus: 1,
          rentalStatusLabel: 1,
          status2: 1,
          status2Label: 1,
          verfuegbar_ab: 1,
          verfuegbarAbText: 1,
          anzahl_zimmer: 1,
          wohnflaeche: 1,
          breitengrad: 1,
          laengengrad: 1,
          titleImage: 1,
          stadtteil: 1,
          ort: 1,
        },
      )
      .lean();
  }

  // ─── Popular areas: count of active properties per district ─────────────────
  async getPopularAreas() {
    return this.onofficeModel.aggregate([
      { $match: { ...this.publishedConditions(), stadtteil: { $ne: '' } } },
      {
        $group: {
          _id: '$stadtteil',
          count: { $sum: 1 },
          city: { $first: '$ort' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, district: '$_id', city: 1, count: 1 } },
    ]);
  }

  // ─── Similar estates (same district or similar price range, exclude self) ────
  async getSimilarEstates(slug: string, limit = 4) {
    const estate = await this.onofficeModel.findOne({
      slug,
      ...this.publishedConditions(),
    });
    if (!estate) throw new HttpException('Estate not found', 404);

    const price = this.getPrice(estate).price;
    const alternatives: Record<string, any>[] = [];
    if (estate.stadtteil) alternatives.push({ stadtteil: estate.stadtteil });
    if (price != null)
      alternatives.push(
        this.buildEstateConditions({
          minPrice: price * 0.7,
          maxPrice: price * 1.3,
        }),
      );
    if (!alternatives.length) return [];

    return this.onofficeModel
      .find({
        ...this.publishedConditions(),
        vermarktungsart: estate.vermarktungsart,
        slug: { $ne: slug },
        $or: alternatives,
      })
      .limit(limit)
      .select(
        'slug objekttitel kaltmiete warmmiete kaufpreis vermarktungsart vermarktungsartLabel price priceType pricePeriod priceLabel rentalStatus rentalStatusLabel anzahl_zimmer wohnflaeche titleImage stadtteil ort',
      )
      .lean();
  }

  // ─── Admin: update extra fields on an estate ────────────────────────────────
  async updateEstate(id: string, updateDto: UpdateOnofficeDto) {
    const result = await this.onofficeModel.findByIdAndUpdate(id, updateDto, {
      new: true,
    });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }
}
