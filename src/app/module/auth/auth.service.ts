import { HttpException, Injectable } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { User, UserDocument } from '../user/entities/user.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import * as jwt from '@nestjs/jwt';
import config from '../../config';
import sendMailer from 'src/app/helpers/sendMailer';
import { createHash, randomBytes, randomInt } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: jwt.JwtService,
  ) {}

  async register(createAuthDto: CreateAuthDto) {
    const existing = await this.userModel.findOne({
      email: createAuthDto.email,
    });
    if (existing) {
      if (!existing.isVerified) {
        const otp = randomInt(100000, 1000000).toString();
        existing.otp = otp;
        existing.otpExpiry = new Date(Date.now() + 60 * 60 * 1000);
        existing.otpAttempts = 0;
        await existing.save();

        const html = `
          <div style="font-family: Arial; text-align: center; padding: 32px;">
            <h2 style="color:#4f46e5;">Verify your email</h2>
            <p>Welcome back! Use the code below to complete your account verification.</p>
            <h1 style="letter-spacing: 6px; font-size: 40px;">${otp}</h1>
            <p style="color:#666;">This code expires in 1 hour.</p>
          </div>
        `;
        await sendMailer(existing.email, 'Verify your email — 0211wohnen', html);

        return {
          message:
            'Account already registered but pending verification. A new verification code has been sent to your email.',
        };
      }
      throw new HttpException('User already exists', 400);
    }

    const otp = randomInt(100000, 1000000).toString();

    const newUser = await this.userModel.create({
      ...createAuthDto,
      isVerified: false,
      otp,
      otpExpiry: new Date(Date.now() + 60 * 60 * 1000),
      otpPurpose: 'signup',
      otpAttempts: 0,
    });

    const html = `
      <div style="font-family: Arial; text-align: center; padding: 32px;">
        <h2 style="color:#4f46e5;">Verify your email</h2>
        <p>Welcome to 0211wohnen! Use the code below to verify your account.</p>
        <h1 style="letter-spacing: 6px; font-size: 40px;">${otp}</h1>
        <p style="color:#666;">This code expires in 1 hour.</p>
      </div>
    `;

    await sendMailer(newUser.email, 'Verify your email — 0211wohnen', html);

    return {
      message:
        'Registration successful. Check your email for the verification code.',
    };
  }

  async login(loginDto: { email: string; password: string }, res: Response) {
    const user = await this.userModel
      .findOne({ email: loginDto.email })
      .select('+password +authVersion');
    if (!user) throw new HttpException('User not found', 404);
    if (user.status !== 'active') throw new HttpException('Account is suspended', 403);

    if (user.role !== 'admin') {
      if (!user.isVerified) {
        throw new HttpException(
          'Please verify your email before logging in',
          403,
        );
      }
    }

    const isPasswordMatch = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordMatch) throw new HttpException('Incorrect password', 401);

    const payload = { id: user._id, email: user.email, role: user.role, authVersion: user.authVersion ?? 0 };
    const accessToken = this.jwtService.sign(payload, {
      secret: config.jwt.accessTokenSecret,
      expiresIn: config.jwt.accessTokenExpires as any,
    } as jwt.JwtSignOptions);
    const refreshToken = this.jwtService.sign(payload, {
      secret: config.jwt.refreshTokenSecret,
      expiresIn: config.jwt.refreshTokenExpires as any,
    } as jwt.JwtSignOptions);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return { accessToken, user: user.toJSON() };
  }

  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) throw new HttpException('Email not found', 404);

    const otp = randomInt(100000, 1000000).toString();
    await this.userModel.updateOne({ _id: user._id }, {
      $set: {
        otp,
        otpExpiry: new Date(Date.now() + 60 * 60 * 1000),
        otpPurpose: 'password-reset',
        otpAttempts: 0,
        verifiedForget: false,
      },
      $unset: { resetTokenHash: 1, resetTokenExpiry: 1 },
    });

    const html = `
      <div style="font-family: Arial; text-align: center; padding: 32px;">
        <h2 style="color:#4f46e5;">Password Reset</h2>
        <p>Your OTP code is:</p>
        <h1 style="letter-spacing: 6px; font-size: 40px;">${otp}</h1>
        <p style="color:#666;">This code expires in 1 hour.</p>
      </div>
    `;

    await sendMailer(user.email, 'Reset Password OTP — 0211wohnen', html);
    return { message: 'Check your email for the OTP code' };
  }

  // Handles BOTH signup verification and forgot-password OTP check
  async verifyEmail(email: string, otp: string) {
    const user = await this.userModel.findOne({ email }).select('+otp +otpExpiry +otpPurpose +otpAttempts');
    if (!user) throw new HttpException('Invalid request', 400);
    if ((user.otpAttempts ?? 0) >= 5) throw new HttpException('Too many attempts. Request a new code.', 429);
    if (!user.otp || user.otp !== otp) {
      await this.userModel.updateOne({ _id: user._id, otp: user.otp }, { $inc: { otpAttempts: 1 } });
      throw new HttpException('Invalid OTP', 400);
    }
    if (!user.otpExpiry || user.otpExpiry < new Date())
      throw new HttpException('OTP expired', 400);

    const isReset = user.otpPurpose === 'password-reset' || (!user.otpPurpose && user.isVerified);
    const resetToken = isReset ? randomBytes(32).toString('hex') : undefined;
    const consumed = await this.userModel.findOneAndUpdate({
      _id: user._id,
      otp,
      otpExpiry: { $gt: new Date() },
      $or: [{ otpAttempts: { $lt: 5 } }, { otpAttempts: { $exists: false } }],
    }, {
      $set: {
        isVerified: true,
        verifiedForget: false,
        ...(resetToken ? {
          resetTokenHash: this.hashResetToken(resetToken),
          resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
        } : {}),
      },
      $unset: { otp: 1, otpExpiry: 1, otpPurpose: 1, otpAttempts: 1 },
    });
    if (!consumed) throw new HttpException('OTP expired or already used', 400);

    return resetToken
      ? { message: 'OTP verified. You can now reset your password.', resetToken }
      : { message: 'Email verified successfully. You can now log in.' };
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async resetPasswordChange(email: string, newPassword: string, resetToken: string) {
    if (!resetToken || !/^[a-f0-9]{64}$/.test(resetToken)) {
      throw new HttpException('Invalid or expired reset token', 400);
    }
    const password = await bcrypt.hash(newPassword, Number(config.bcryptSaltRounds));
    // Match and consume the secret atomically so concurrent requests cannot reuse it.
    const user = await this.userModel.findOneAndUpdate({
      email,
      resetTokenHash: this.hashResetToken(resetToken),
      resetTokenExpiry: { $gt: new Date() },
    }, {
      $set: { password, verifiedForget: false },
      $unset: { resetTokenHash: 1, resetTokenExpiry: 1, otp: 1, otpExpiry: 1, otpPurpose: 1, otpAttempts: 1 },
      $inc: { authVersion: 1 },
    }, { new: true, runValidators: true });
    if (!user) throw new HttpException('Invalid or expired reset token', 400);

    return { message: 'Password reset successfully' };
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.userModel.findById(userId).select('+password +authVersion');
    if (!user) throw new HttpException('User not found', 404);

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new HttpException('Invalid old password', 400);
    if (oldPassword === newPassword)
      throw new HttpException(
        'New password cannot be same as old password',
        400,
      );

    user.password = newPassword;
    await user.save();

    return { message: 'Password changed successfully' };
  }
}
