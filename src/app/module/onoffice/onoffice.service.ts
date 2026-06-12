import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Onoffice } from './entities/onoffice.entity';
import { IFilterParams } from 'src/app/helpers/pick';
import paginationHelper, { IOptions } from 'src/app/helpers/pagenation';
import { UpdateOnofficeDto } from './dto/update-onoffice.dto';

@Injectable()
export class OnofficeService {
  // Cached field definitions from onOffice (populated once per sync)
  private fieldDefs: Record<string, any> = {};

  constructor(
    private readonly httpService: HttpService,
    @InjectModel(Onoffice.name)
    private readonly onofficeModel: Model<Onoffice>,
  ) {}

  private getCredentials() {
    return {
      token: process.env.ONOFFICE_ESTATE_TOKEN || process.env.ONOFFICE_TOKEN || '',
      secret: process.env.ONOFFICE_ESTATE_SECRET || process.env.ONOFFICE_SECRET || '',
      pictureToken: process.env.ONOFFICE_PICTURE_TOKEN || process.env.ONOFFICE_TOKEN || '',
      pictureSecret: process.env.ONOFFICE_PICTURE_SECRET || process.env.ONOFFICE_SECRET || '',
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
    const n = parseFloat(String(val ?? ''));
    return isNaN(n) ? 0 : n;
  }

  // Any value (including arrays) → safe string
  private toStr(val: any): string {
    if (val == null || val === '') return '';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  // Translate onOffice internal key(s) → human-readable label using permittedvalues
  private resolveLabel(fieldName: string, value: any): string {
    if (value == null || value === '') return '';
    const arr = Array.isArray(value) ? value : [value];
    const permitted: Record<string, string> = this.fieldDefs[fieldName]?.permittedvalues ?? {};
    return arr.map((k) => permitted[k] ?? String(k)).join(', ');
  }

  // Load field definitions from onOffice and cache them in this.fieldDefs
  private async loadFieldDefinitions(): Promise<string[]> {
    const { token, secret } = this.getCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const actionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:get';
    const hmac = this.generateHmac(timestamp, token, 'fields', actionId, secret);

    const res = await firstValueFrom(
      this.httpService.post('https://api.onoffice.de/api/stable/api.php', {
        token,
        request: {
          actions: [{
            actionid: actionId,
            resourceid: '',
            identifier: 'get-fields',
            resourcetype: 'fields',
            timestamp,
            hmac,
            hmac_version: '2',
            parameters: { modules: ['estate'], labels: true, language: 'ENG' },
          }],
        },
      }),
    );

    const records = res.data?.response?.results?.[0]?.data?.records || [];
    const estateModule = records.find((r: any) => r.id === 'estate');
    this.fieldDefs = estateModule?.elements ?? {};
    return Object.keys(this.fieldDefs);
  }

  // ─── Auto sync every 10 minutes ─────────────────────────────────────────────
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoSync() {
    console.log('[AutoSync] Starting scheduled onOffice sync...');
    try {
      const result = await this.fullSync();
      console.log(`[AutoSync] Done — synced: ${result.synced}, deactivated: ${result.deactivated}`);
    } catch (err: any) {
      console.error('[AutoSync] Failed:', err?.message);
    }
  }

  // ─── Get all available estate fields (also used by debug endpoint) ──────────
  async getAvailableEstateFields(): Promise<{ fields: string[]; defs: Record<string, any> }> {
    const fields = await this.loadFieldDefinitions();
    return { fields, defs: this.fieldDefs };
  }

  // ─── Full sync: fetches ALL properties in one call ──────────────────────────
  async fullSync() {
    const { token, secret, pictureToken, pictureSecret } = this.getCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const estateActionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:read';
    const imageActionId = 'urn:onoffice-de-ns:smart:2.5:smartml:action:get';

    const estateHmac = this.generateHmac(timestamp, token, 'estate', estateActionId, secret);
    const imageHmac = this.generateHmac(timestamp, pictureToken, 'estatepictures', imageActionId, pictureSecret);

    // Step 0: load field definitions (populates this.fieldDefs + returns available keys)
    const availableFields = await this.loadFieldDefinitions();

    const desiredFields = [
      'Id',
      'objekttitel', 'objektart', 'objekttyp',
      'kaltmiete', 'warmmiete', 'kaufpreis', 'kaution', 'nebenkosten',
      'anzahl_zimmer', 'anzahl_badezimmer', 'anzahl_schlafzimmer',
      'wohnflaeche',
      'ort', 'plz', 'strasse', 'hausnummer',
      'stadtteil', 'regionaler_zusatz',   // both — whichever exists
      'breitengrad', 'laengengrad',
      'objektbeschreibung', 'lage', 'ausstatt_beschr',
      'vermarktungsart', 'status', 'veroeffentlichen', 'verfuegbar_ab',
      'balkon', 'terrasse', 'fahrstuhl', 'moebliert', 'haustiere',
    ];

    // 'Id' is always valid; skip availability check for it
    const data = desiredFields.filter(
      (f) => f === 'Id' || availableFields.includes(f),
    );

    const missing = desiredFields.filter((f) => f !== 'Id' && !availableFields.includes(f));
    if (missing.length) {
      console.warn('[Sync] Fields not available in this onOffice account, skipped:', missing.join(', '));
    }

    // Step 1: fetch all published estates
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
                data,
                listlimit: 500,
                listoffset: 0,
                filter: {
                  veroeffentlichen: [{ op: '=', val: 1 }],
                },
                sortby: { Id: 'ASC' },
                estatelanguage: 'DEU',
              },
            },
          ],
        },
      }),
    );

    const estateResult = estateResponse.data?.response?.results?.[0];
    if (estateResult?.status?.errorcode !== 0) {
      throw new HttpException(
        `Estate fetch failed: ${estateResult?.status?.message} (code: ${estateResult?.status?.errorcode})`,
        500,
      );
    }

    const estates = estateResult.data.records as any[];
    const total = estateResult.data.meta.cntabsolute;
    const estateIds = estates.map((e: any) => parseInt(e.id));

    // Step 2: fetch images for all estates
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
                categories: ['Titelbild', 'Foto', 'Grundriss'],
              },
            },
          ],
        },
      }),
    );

    const imageRecords = imageResponse.data?.response?.results?.[0]?.data?.records || [];
    const imageMap: Record<string, any[]> = {};
    for (const record of imageRecords) {
      const element = record.elements?.[0];
      if (!element) continue;
      const estId = element.estateid;
      if (!imageMap[estId]) imageMap[estId] = [];
      imageMap[estId].push({ id: record.id, type: element.type, url: element.url, title: element.title });
    }

    // Step 3: upsert into MongoDB
    let synced = 0;
    let errors = 0;
    const syncedIds: number[] = [];

    for (const estate of estates) {
      const el = estate.elements;
      const id = parseInt(estate.id);
      const images = imageMap[estate.id] || [];
      const titleImage = images.find((img) => img.type === 'Titelbild') || images[0] || null;

      let verfuegbar: Date | null = null;
      if (el.verfuegbar_ab) {
        const parsed = new Date(el.verfuegbar_ab);
        if (!isNaN(parsed.getTime())) verfuegbar = parsed;
      }

      try {
        await this.onofficeModel.findOneAndUpdate(
          { onofficeId: id },
          {
            $set: {
              onofficeId: id,
              slug: this.generateSlug(this.toStr(el.objekttitel), id),
              objekttitel: this.toStr(el.objekttitel),
              objektbeschreibung: this.toStr(el.objektbeschreibung),
              lage: this.toStr(el.lage),
              ausstatt_beschr: this.toStr(el.ausstatt_beschr),
              wohnflaeche: this.toNum(el.wohnflaeche),
              anzahl_zimmer: this.toNum(el.anzahl_zimmer),
              anzahl_badezimmer: this.toNum(el.anzahl_badezimmer),
              anzahl_schlafzimmer: this.toNum(el.anzahl_schlafzimmer),
              kaltmiete: this.toNum(el.kaltmiete),
              warmmiete: this.toNum(el.warmmiete),
              kaufpreis: this.toNum(el.kaufpreis),
              kaution: this.toNum(el.kaution),
              nebenkosten: this.toNum(el.nebenkosten),
              // Select/multiselect fields — translate internal keys to labels
              vermarktungsart: this.resolveLabel('vermarktungsart', el.vermarktungsart),
              objektart: this.resolveLabel('objektart', el.objektart),
              objekttyp: this.resolveLabel('objekttyp', el.objekttyp),
              status: this.resolveLabel('status', el.status),
              balkon: this.resolveLabel('balkon', el.balkon),
              terrasse: this.resolveLabel('terrasse', el.terrasse),
              fahrstuhl: this.resolveLabel('fahrstuhl', el.fahrstuhl),
              moebliert: this.resolveLabel('moebliert', el.moebliert),
              haustiere: this.resolveLabel('haustiere', el.haustiere),
              veroeffentlichen: this.toStr(el.veroeffentlichen),
              // District: try stadtteil first, then regionaler_zusatz (both with label resolution)
              stadtteil:
                this.resolveLabel('stadtteil', el.stadtteil) ||
                this.resolveLabel('regionaler_zusatz', el.regionaler_zusatz),
              ort: this.toStr(el.ort),
              plz: this.toStr(el.plz),
              strasse: this.toStr(el.strasse),
              hausnummer: this.toStr(el.hausnummer),
              breitengrad: el.breitengrad ? this.toNum(el.breitengrad) : null,
              laengengrad: el.laengengrad ? this.toNum(el.laengengrad) : null,
              verfuegbar_ab: verfuegbar,
              images,
              titleImage,
              isActive: true,
              syncedAt: new Date(),
            },
          },
          { upsert: true },
        );
        synced++;
        syncedIds.push(id);
      } catch (err: any) {
        errors++;
        console.error(`Upsert failed for estate ${estate.id}:`, err?.message);
      }
    }

    // Step 4: deactivate only if sync succeeded — guard against wiping DB on API failure
    let deactivated = 0;
    if (syncedIds.length > 0) {
      const r = await this.onofficeModel.updateMany(
        { onofficeId: { $nin: syncedIds }, isActive: true },
        { $set: { isActive: false } },
      );
      deactivated = r.modifiedCount;
    } else {
      console.warn('[Sync] No properties synced — skipping deactivation to protect existing data.');
    }

    return { total, synced, errors, deactivated, syncedAt: new Date() };
  }

  // ─── Manual sync endpoint (admin) — delegates to fullSync ───────────────────
  async syncFromOnOffice() {
    return this.fullSync();
  }

  // ─── Get paginated list from DB ──────────────────────────────────────────────
  async getEstatesFromDB(params: IFilterParams, options: IOptions) {
    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);

    const conditions: Record<string, any> = { isActive: true };

    if (params.searchTerm) {
      const regex = new RegExp(params.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.$or = [
        { objekttitel: regex },
        { objektbeschreibung: regex },
        { lage: regex },
        { ort: regex },
        { stadtteil: regex },
      ];
    }

    if (params.district) conditions.stadtteil = new RegExp(String(params.district), 'i');
    if (params.vermarktungsart) conditions.vermarktungsart = params.vermarktungsart;
    if (params.objektart) conditions.objektart = params.objektart;
    if (params.status) conditions.status = params.status;

    if (params.minRooms || params.maxRooms) {
      conditions.anzahl_zimmer = {};
      if (params.minRooms) conditions.anzahl_zimmer.$gte = Number(params.minRooms);
      if (params.maxRooms) conditions.anzahl_zimmer.$lte = Number(params.maxRooms);
    }

    if (params.minPrice || params.maxPrice) {
      conditions.kaltmiete = {};
      if (params.minPrice) conditions.kaltmiete.$gte = Number(params.minPrice);
      if (params.maxPrice) conditions.kaltmiete.$lte = Number(params.maxPrice);
    }

    if (params.minArea || params.maxArea) {
      conditions.wohnflaeche = {};
      if (params.minArea) conditions.wohnflaeche.$gte = Number(params.minArea);
      if (params.maxArea) conditions.wohnflaeche.$lte = Number(params.maxArea);
    }

    if (params.availableFrom) {
      conditions.verfuegbar_ab = { $lte: new Date(String(params.availableFrom)) };
    }

    const [data, total] = await Promise.all([
      this.onofficeModel.find(conditions).skip(skip).limit(limit).sort({ [sortBy]: sortOrder } as any),
      this.onofficeModel.countDocuments(conditions),
    ]);

    return { data, meta: { total, page, limit } };
  }

  // ─── Single estate by MongoDB _id ───────────────────────────────────────────
  async getSingleEstateFromDB(id: string) {
    const result = await this.onofficeModel.findById(id);
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Single estate by slug ───────────────────────────────────────────────────
  async getEstateBySlug(slug: string) {
    const result = await this.onofficeModel.findOne({ slug, isActive: true });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Single estate by onofficeId ────────────────────────────────────────────
  async getEstateByOnofficeId(onofficeId: number) {
    const result = await this.onofficeModel.findOne({ onofficeId, isActive: true });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }

  // ─── Map pins: lightweight payload for all active properties ────────────────
  async getMapPins() {
    return this.onofficeModel
      .find(
        { isActive: true, breitengrad: { $ne: null }, laengengrad: { $ne: null } },
        {
          _id: 1,
          slug: 1,
          objekttitel: 1,
          kaltmiete: 1,
          kaufpreis: 1,
          vermarktungsart: 1,
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
      { $match: { isActive: true, stadtteil: { $ne: '' } } },
      { $group: { _id: '$stadtteil', count: { $sum: 1 }, city: { $first: '$ort' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, district: '$_id', city: 1, count: 1 } },
    ]);
  }

  // ─── Similar estates (same district or similar price range, exclude self) ────
  async getSimilarEstates(slug: string, limit = 4) {
    const estate = await this.onofficeModel.findOne({ slug, isActive: true });
    if (!estate) throw new HttpException('Estate not found', 404);

    const priceField = estate.vermarktungsart === 'kauf' ? 'kaufpreis' : 'kaltmiete';
    const price = estate.vermarktungsart === 'kauf' ? estate.kaufpreis : estate.kaltmiete;
    const priceRange = price * 0.3;

    return this.onofficeModel
      .find({
        isActive: true,
        slug: { $ne: slug },
        $or: [
          { stadtteil: estate.stadtteil || undefined },
          {
            [priceField]: { $gte: price - priceRange, $lte: price + priceRange },
          },
        ],
      })
      .limit(limit)
      .select('slug objekttitel kaltmiete kaufpreis vermarktungsart anzahl_zimmer wohnflaeche titleImage stadtteil ort')
      .lean();
  }

  // ─── Admin: update extra fields on an estate ────────────────────────────────
  async updateEstate(id: string, updateDto: UpdateOnofficeDto) {
    const result = await this.onofficeModel.findByIdAndUpdate(id, updateDto, { new: true });
    if (!result) throw new HttpException('Estate not found', 404);
    return result;
  }
}
