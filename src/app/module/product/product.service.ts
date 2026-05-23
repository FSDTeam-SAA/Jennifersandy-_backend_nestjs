import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import crypto from 'crypto';
import { Model } from 'mongoose';
import config from 'src/app/config';
import buildWhereConditions from 'src/app/helpers/buildWhereConditions';
import paginationHelper, { IOptions } from 'src/app/helpers/pagenation';
import { IFilterParams } from 'src/app/helpers/pick';
import { CreateProductDto } from './dto/create-product.dto';
import { SyncOnOfficeProductsDto } from './dto/sync-onoffice-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  Product,
  ProductDocument,
  ProductImage,
} from './entities/product.entity';

const READ_ACTION_ID = 'urn:onoffice-de-ns:smart:2.5:smartml:action:read';
const GET_ACTION_ID = 'urn:onoffice-de-ns:smart:2.5:smartml:action:get';

type OnOfficeEstateElements = Record<string, string | undefined>;

type OnOfficeEstateRecord = {
  id: number;
  elements: OnOfficeEstateElements;
};

type OnOfficePictureElement = {
  estateid: string;
  type: string;
  url: string;
  title?: string;
  text?: string;
  originalname?: string;
  modified?: number;
  estateMainId?: string;
};

type OnOfficePictureRecord = {
  id: number;
  elements: OnOfficePictureElement[];
};

type OnOfficeResult<T> = {
  data?: {
    meta?: {
      cntabsolute?: number;
    };
    records?: T[];
  };
  status?: {
    errorcode?: number;
    message?: string;
  };
};

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async createProduct(createProductDto: CreateProductDto) {
    return this.productModel.create(createProductDto);
  }

  async getAllProducts(params: IFilterParams, options: IOptions) {
    const { limit, page, skip, sortBy, sortOrder } = paginationHelper(options);
    const searchAbleFields = ['title', 'externalNumber', 'city', 'postalCode'];
    const whenConditation = buildWhereConditions(params, searchAbleFields);

    const result = await this.productModel
      .find(whenConditation)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit);

    const total = await this.productModel.countDocuments(whenConditation);

    return {
      meta: {
        page,
        limit,
        total,
      },
      data: result,
    };
  }

  async getSingleProduct(id: string) {
    const result = await this.productModel.findById(id);
    if (!result) throw new HttpException('Product is not found', 404);
    return result;
  }

  async updateProduct(id: string, updateProductDto: UpdateProductDto) {
    return this.productModel.findByIdAndUpdate(id, updateProductDto, {
      new: true,
    });
  }

  async deleteProduct(id: string) {
    return this.productModel.findByIdAndDelete(id);
  }

  async syncFromOnOffice(syncDto: SyncOnOfficeProductsDto = {}) {
    const listLimit = syncDto.listLimit ?? 10;
    const listOffset = syncDto.listOffset ?? 0;
    const maxPages = syncDto.maxPages ?? 10;
    const syncAll = syncDto.syncAll ?? true;
    const estates: OnOfficeEstateRecord[] = [];
    let cntabsolute = 0;
    let offset = listOffset;
    let pagesRead = 0;

    do {
      const result = await this.readEstates(listLimit, offset);
      const records = result.data?.records ?? [];
      cntabsolute = result.data?.meta?.cntabsolute ?? cntabsolute;
      estates.push(...records);
      pagesRead += 1;
      offset += listLimit;

      if (!syncAll || records.length === 0 || pagesRead >= maxPages) break;
    } while (estates.length < cntabsolute);

    const estateIds = estates.map((estate) => estate.id);
    const imagesByEstateId = await this.getImagesByEstateId(estateIds, syncDto);
    const syncedAt = new Date();

    const operations = estates.map((estate) => {
      const product = this.mapEstateToProduct(
        estate,
        imagesByEstateId.get(String(estate.id)) ?? [],
        syncedAt,
      );

      return {
        updateOne: {
          filter: { onOfficeEstateId: product.onOfficeEstateId },
          update: { $set: product },
          upsert: true,
        },
      };
    });

    const writeResult = operations.length
      ? await this.productModel.bulkWrite(operations)
      : null;

    return {
      totalAvailable: cntabsolute,
      totalFetched: estates.length,
      totalImages: Array.from(imagesByEstateId.values()).reduce(
        (total, images) => total + images.length,
        0,
      ),
      totalProductsWithImages: Array.from(imagesByEstateId.values()).filter(
        (images) => images.length > 0,
      ).length,
      sampleEstateIdsWithoutImages: estateIds
        .filter((estateId) => !imagesByEstateId.has(String(estateId)))
        .slice(0, 10),
      upserted: writeResult?.upsertedCount ?? 0,
      matched: writeResult?.matchedCount ?? 0,
      modified: writeResult?.modifiedCount ?? 0,
      pagesRead,
      syncedAt,
    };
  }

  async getSyncStatus() {
    const totalProducts = await this.productModel.countDocuments();
    const latestProduct = await this.productModel
      .findOne()
      .sort({ syncedAt: -1 })
      .select('syncedAt');

    return {
      connected: this.hasOnOfficeConfig(),
      totalProducts,
      lastSyncTime: latestProduct?.syncedAt ?? null,
    };
  }

  private async readEstates(listlimit: number, listoffset: number) {
    const onOfficeConfig = this.getOnOfficeConfig();
    const response = await this.callOnOffice<OnOfficeEstateRecord>({
      token: this.requiredConfig(
        onOfficeConfig.estateToken,
        'ONOFFICE_ESTATE_TOKEN',
      ),
      secret: this.requiredConfig(
        onOfficeConfig.estateSecret,
        'ONOFFICE_ESTATE_SECRET',
      ),
      resourceType: 'estate',
      actionId: READ_ACTION_ID,
      identifier: 'read_estates',
      parameters: {
        data: [
          'Id',
          'objektnr_extern',
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
          'breitengrad',
          'laengengrad',
          'veroeffentlichen',
          'status',
          'objektart',
          'objekttyp',
          'vermarktungsart',
          'nutzungsart',
          'geaendert_am',
        ],
        listlimit,
        listoffset,
      },
    });

    return response;
  }

  private async getImagesByEstateId(
    estateIds: number[],
    syncDto: SyncOnOfficeProductsDto,
  ) {
    const imagesByEstateId = new Map<string, ProductImage[]>();
    const chunkSize = 50;
    const onOfficeConfig = this.getOnOfficeConfig();

    for (let index = 0; index < estateIds.length; index += chunkSize) {
      const chunk = estateIds.slice(index, index + chunkSize);
      const result = await this.callOnOffice<OnOfficePictureRecord>({
        token: this.requiredConfig(
          onOfficeConfig.pictureToken,
          'ONOFFICE_PICTURE_TOKEN',
        ),
        secret: this.requiredConfig(
          onOfficeConfig.pictureSecret,
          'ONOFFICE_PICTURE_SECRET',
        ),
        resourceType: 'estatepictures',
        actionId: GET_ACTION_ID,
        identifier: 'get_estate_images',
        parameters: {
          estateids: chunk,
          categories: syncDto.categories ?? ['Titelbild', 'Foto', 'Grundriss'],
          size: syncDto.size ?? '800x600',
          publicationSetting: syncDto.publicationSetting ?? 'Homepage',
        },
      });

      for (const record of result.data?.records ?? []) {
        const imageElements = Array.isArray(record.elements)
          ? record.elements
          : Object.values(record.elements ?? {});

        for (const image of imageElements) {
          if (!this.isOnOfficePictureElement(image)) continue;

          const normalizedImage = this.mapImage(record.id, image);
          const existing = imagesByEstateId.get(image.estateid) ?? [];
          existing.push(normalizedImage);
          imagesByEstateId.set(image.estateid, existing);
        }
      }
    }

    return imagesByEstateId;
  }

  private async callOnOffice<T>(payload: {
    token: string;
    secret: string;
    resourceType: string;
    actionId: string;
    identifier: string;
    parameters: Record<string, unknown>;
  }) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmac = crypto
      .createHmac('sha256', payload.secret)
      .update(
        timestamp + payload.token + payload.resourceType + payload.actionId,
      )
      .digest('base64');

    const { data } = await axios.post<{
      status?: { code?: number; errorcode?: number; message?: string };
      response?: { results?: OnOfficeResult<T>[] };
    }>(config.onOffice.apiUrl, {
      token: payload.token,
      request: {
        actions: [
          {
            actionid: payload.actionId,
            resourceid: '',
            identifier: payload.identifier,
            resourcetype: payload.resourceType,
            timestamp,
            hmac,
            hmac_version: '2',
            parameters: payload.parameters,
          },
        ],
      },
    });

    if (data.status?.errorcode) {
      throw new HttpException(
        data.status.message || 'onOffice request failed',
        502,
      );
    }

    const result = data.response?.results?.[0];
    if (!result || result.status?.errorcode) {
      throw new HttpException(
        result?.status?.message || 'onOffice result is invalid',
        502,
      );
    }

    return result;
  }

  private mapEstateToProduct(
    estate: OnOfficeEstateRecord,
    images: ProductImage[],
    syncedAt: Date,
  ) {
    const elements = estate.elements;

    return {
      onOfficeEstateId: this.toNumber(elements.Id, estate.id),
      externalNumber: elements.objektnr_extern ?? '',
      title: elements.objekttitel ?? '',
      coldRent: this.toNumber(elements.kaltmiete),
      warmRent: this.toNumber(elements.warmmiete),
      purchasePrice: this.toNumber(elements.kaufpreis),
      rooms: this.toNumber(elements.anzahl_zimmer),
      livingArea: this.toNumber(elements.wohnflaeche),
      city: elements.ort ?? '',
      postalCode: elements.plz ?? '',
      street: elements.strasse ?? '',
      houseNumber: elements.hausnummer ?? '',
      latitude: this.toNumber(elements.breitengrad),
      longitude: this.toNumber(elements.laengengrad),
      publish: elements.veroeffentlichen ?? '',
      status: elements.status ?? '',
      objectKind: elements.objektart ?? '',
      objectType: elements.objekttyp ?? '',
      marketingType: elements.vermarktungsart ?? '',
      usageType: elements.nutzungsart ?? '',
      changedAt: elements.geaendert_am ?? '',
      images,
      syncedAt,
    };
  }

  private mapImage(
    fileId: number,
    image: OnOfficePictureElement,
  ): ProductImage {
    return {
      fileId,
      estateId: image.estateid,
      category: image.type,
      url: image.url,
      title: image.title ?? '',
      text: image.text ?? '',
      originalName: image.originalname ?? '',
      modified: image.modified ?? 0,
      estateMainId: image.estateMainId ?? '',
    };
  }

  private isOnOfficePictureElement(
    value: unknown,
  ): value is OnOfficePictureElement {
    if (!value || typeof value !== 'object') return false;

    const image = value as Partial<OnOfficePictureElement>;
    return Boolean(image.estateid && image.type && image.url);
  }

  private toNumber(value: string | undefined, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private requiredConfig(value: string | undefined, key: string) {
    if (!value) throw new HttpException(`${key} is missing`, 500);
    return value;
  }

  private hasOnOfficeConfig() {
    const onOfficeConfig = this.getOnOfficeConfig();

    return Boolean(
      onOfficeConfig.estateToken &&
      onOfficeConfig.estateSecret &&
      onOfficeConfig.pictureToken &&
      onOfficeConfig.pictureSecret,
    );
  }

  private getOnOfficeConfig() {
    return {
      estateToken:
        process.env.ONOFFICE_ESTATE_TOKEN || config.onOffice.estateToken,
      estateSecret:
        process.env.ONOFFICE_ESTATE_SECRET || config.onOffice.estateSecret,
      pictureToken:
        process.env.ONOFFICE_PICTURE_TOKEN || config.onOffice.pictureToken,
      pictureSecret:
        process.env.ONOFFICE_PICTURE_SECRET || config.onOffice.pictureSecret,
    };
  }
}
