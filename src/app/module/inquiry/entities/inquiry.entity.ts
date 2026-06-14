import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';

export type InquiryDocument = HydratedDocument<Inquiry>;

@Schema({ timestamps: true })
export class Inquiry {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Onoffice' })
  onOfficeId!: Types.ObjectId;

  @Prop()
  firstName!: string;

  @Prop()
  lastName!: string;

  @Prop()
  email!: string;

  @Prop()
  phoneNumber!: string;

  @Prop()
  message!: string;

  @Prop({ default: 'new' })
  status!: string;
}

export const InquirySchema = SchemaFactory.createForClass(Inquiry);
