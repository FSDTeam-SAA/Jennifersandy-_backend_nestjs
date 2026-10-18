import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type UserDocument = HydratedDocument<User>;
import * as bcrypt from 'bcrypt';
import config from '../../../config';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: [true, 'First name is required'], trim: true })
  firstName!: string;

  @Prop({ required: [true, 'Last name is required'], trim: true })
  lastName!: string;

  @Prop({ required: [true, 'Email is required'], unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: [true, 'Password is required'], minlength: 6, select: false })
  password!: string;

  @Prop({ enum: ['user', 'admin'], default: 'user' })
  role!: string;

  @Prop({ enum: ['male', 'female'] })
  gender!: string;

  @Prop()
  bio?: string;

  @Prop()
  streetAddress!: string;

  @Prop()
  location!: string;

  @Prop()
  profilePicture!: string;

  @Prop()
  postalCode?: string;

  @Prop()
  phoneNumber?: string;

  @Prop({ select: false })
  otp?: string;

  @Prop({ select: false })
  otpExpiry?: Date;

  @Prop({ select: false, enum: ['signup', 'password-reset'] })
  otpPurpose?: string;

  @Prop({ select: false, default: 0 })
  otpAttempts?: number;

  @Prop({ select: false })
  resetTokenHash?: string;

  @Prop({ select: false })
  resetTokenExpiry?: Date;

  @Prop({ select: false, default: 0 })
  authVersion?: number;

  @Prop({ default: false })
  isVerified!: boolean;

  @Prop({ enum: ['active', 'suspended'], default: 'active' })
  status!: string;

  @Prop({ select: false })
  verifiedForget!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', async function () {
  if (!this.isNew && (this.isModified('password') || this.isModified('role') || this.isModified('status'))) {
    this.authVersion = (this.authVersion ?? 0) + 1;
  }
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, Number(config.bcryptSaltRounds));
});

UserSchema.set('toJSON', {
  transform: (_document, result: Record<string, any>) => {
    for (const field of ['password', 'otp', 'otpExpiry', 'otpPurpose', 'otpAttempts', 'verifiedForget', 'resetTokenHash', 'resetTokenExpiry', 'authVersion']) {
      delete result[field];
    }
    return result;
  },
});
