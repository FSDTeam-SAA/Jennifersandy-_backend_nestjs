import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

@Schema({ _id: false })
export class ProductImage {
  @Prop()
  fileId!: number;

  @Prop()
  estateId!: string;

  @Prop()
  category!: string;

  @Prop()
  url!: string;

  @Prop()
  title!: string;

  @Prop()
  text!: string;

  @Prop()
  originalName!: string;

  @Prop()
  modified!: number;

  @Prop()
  estateMainId!: string;
}

export const ProductImageSchema = SchemaFactory.createForClass(ProductImage);

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, unique: true, index: true })
  onOfficeEstateId!: number;

  @Prop({ index: true })
  externalNumber!: string;

  @Prop({ index: true })
  title!: string;

  @Prop()
  coldRent!: number;

  @Prop()
  warmRent!: number;

  @Prop()
  purchasePrice!: number;

  @Prop()
  rooms!: number;

  @Prop()
  livingArea!: number;

  @Prop({ index: true })
  city!: string;

  @Prop()
  postalCode!: string;

  @Prop()
  street!: string;

  @Prop()
  houseNumber!: string;

  @Prop()
  latitude!: number;

  @Prop()
  longitude!: number;

  @Prop()
  publish!: string;

  @Prop({ index: true })
  status!: string;

  @Prop()
  objectKind!: string;

  @Prop()
  objectType!: string;

  @Prop()
  marketingType!: string;

  @Prop()
  usageType!: string;

  @Prop()
  changedAt!: string;

  @Prop({ type: [ProductImageSchema], default: [] })
  images!: ProductImage[];

  @Prop()
  syncedAt!: Date;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

