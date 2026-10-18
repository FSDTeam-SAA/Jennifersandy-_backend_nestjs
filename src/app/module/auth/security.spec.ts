import 'reflect-metadata';
import { createHash } from 'crypto';
import { ExecutionContext, Logger, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Model, model } from 'mongoose';
import AuthGuard from '../../middlewares/auth.guard';
import { User, UserDocument, UserSchema } from '../user/entities/user.entity';
import { UpdateProfileDto } from '../user/dto/update-profile.dto';
import { UserService } from '../user/user.service';
import { UserController } from '../user/user.controller';
import { BlogController } from '../blog/blog.controller';
import { BlogService } from '../blog/blog.service';
import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

jest.mock('src/app/helpers/sendMailer', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('src/app/helpers/fileUploder', () => ({ fileUpload: { uploadConfig: {} } }));

describe('account and blog security regressions (no database or network)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('strips privileges and recovery credentials from the public profile DTO', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform({
      firstName: 'Safe', role: 'admin', password: 'unsafe-password',
      email: 'attacker@example.test', verifiedForget: true, otp: '123456',
    }, { type: 'body', metatype: UpdateProfileDto });
    expect(result).toEqual({ firstName: 'Safe' });
  });

  it('also enforces the profile allowlist when invoked without the validation pipe', async () => {
    const userModel = {
      findById: jest.fn().mockResolvedValue({ _id: 'user-id' }),
      findByIdAndUpdate: jest.fn().mockResolvedValue({ _id: 'user-id' }),
    };
    const service = new UserService(userModel as unknown as Model<UserDocument>);
    await service.updateMyProfile('user-id', { firstName: 'Safe', role: 'admin', verifiedForget: true } as UpdateProfileDto);
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith('user-id', {
      $set: { firstName: 'Safe' },
    }, { new: true, runValidators: true });
  });

  it('does not serialize passwords or recovery secrets even for newly created documents', () => {
    const UserModel = model('SecuritySerializationUser', UserSchema);
    const user = new UserModel({
      firstName: 'Safe', lastName: 'User', email: 'safe@example.test',
      password: 'password-hash', otp: '123456', otpExpiry: new Date(),
      resetTokenHash: 'secret-hash', resetTokenExpiry: new Date(), verifiedForget: true,
    });
    const serialized = user.toJSON();
    expect(serialized.firstName).toBe('Safe');
    for (const field of ['password', 'otp', 'otpExpiry', 'resetTokenHash', 'resetTokenExpiry', 'verifiedForget', 'authVersion']) {
      expect(serialized).not.toHaveProperty(field);
    }
  });

  it('protects user lookups and draft blog reads as well as every blog mutation', () => {
    for (const handler of [
      UserController.prototype.getSingleUser,
      BlogController.prototype.findOneBlog,
      BlogController.prototype.createBlog,
      BlogController.prototype.updateBlog,
      BlogController.prototype.remove,
    ]) {
      expect(Reflect.getMetadata('__guards__', handler)).toHaveLength(1);
    }
  });

  it.each([
    [null, 'deleted user'],
    [{ role: 'admin', status: 'suspended', authVersion: 0 }, 'suspended user'],
    [{ role: 'user', status: 'active', authVersion: 0 }, 'demoted administrator'],
    [{ role: 'admin', status: 'active', authVersion: 1 }, 'revoked password/session'],
  ])('rejects an otherwise valid admin token for %s (%s)', async (user) => {
    const Guard = AuthGuard('admin');
    const jwt = { verify: jest.fn().mockReturnValue({ id: 'user-id', email: 'user@example.test', role: 'admin', authVersion: 0 }) };
    const userModel = { findById: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) }) };
    const guard = new (Guard as any)(jwt, userModel);
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
  });

  it('accepts a current active administrator and attaches its verified identity', async () => {
    const Guard = AuthGuard('admin');
    const identity = { id: 'user-id', email: 'user@example.test', role: 'admin', authVersion: 2 };
    const guard = new (Guard as any)(
      { verify: () => identity },
      { findById: () => ({ select: async () => ({ role: 'admin', status: 'active', authVersion: 2 }) }) },
    );
    const request: any = { headers: { authorization: 'Bearer valid-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(identity);
  });

  it('exchanges a reset OTP for a hashed, expiring secret and atomically consumes the OTP', async () => {
    const userModel = {
      findOne: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({
        _id: 'user-id', email: 'safe@example.test', otp: '123456',
        otpExpiry: new Date(Date.now() + 60000), otpPurpose: 'password-reset', otpAttempts: 0,
      }) }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'user-id' }),
    };
    const service = new AuthService(userModel as unknown as Model<UserDocument>, {} as JwtService);
    const before = Date.now();
    const result = await service.verifyEmail('safe@example.test', '123456');
    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/);
    const [query, update] = userModel.findOneAndUpdate.mock.calls[0];
    expect(query).toMatchObject({ _id: 'user-id', otp: '123456' });
    expect(update.$set.resetTokenHash).toBe(createHash('sha256').update(result.resetToken!).digest('hex'));
    expect(update.$set.resetTokenHash).not.toBe(result.resetToken);
    expect(update.$set.resetTokenExpiry.getTime()).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(update.$unset).toHaveProperty('otp');
    expect(update.$set.verifiedForget).toBe(false);
  });

  it('caps OTP guesses and cannot exchange an already consumed OTP', async () => {
    const userModel = {
      findOne: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({
        _id: 'user-id', otp: '123456', otpExpiry: new Date(Date.now() + 60000), otpAttempts: 5,
      }) }),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
    const service = new AuthService(userModel as unknown as Model<UserDocument>, {} as JwtService);
    await expect(service.verifyEmail('safe@example.test', '123456')).rejects.toThrow('Too many attempts');
    userModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({
      _id: 'user-id', otp: '123456', otpExpiry: new Date(Date.now() + 60000), otpAttempts: 0,
    }) });
    await expect(service.verifyEmail('safe@example.test', '123456')).rejects.toThrow('already used');
  });

  it('does not reset a password based only on email or the legacy verifiedForget flag', async () => {
    const userModel = { findOneAndUpdate: jest.fn() };
    const service = new AuthService(userModel as unknown as Model<UserDocument>, {} as JwtService);
    await expect(service.resetPasswordChange('safe@example.test', 'new-password', '')).rejects.toThrow('Invalid or expired');
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('binds password resets to email, token hash and expiry; consumes the token and revokes prior JWTs', async () => {
    const userModel = { findOneAndUpdate: jest.fn().mockResolvedValueOnce({ _id: 'user-id' }).mockResolvedValue(null) };
    const service = new AuthService(userModel as unknown as Model<UserDocument>, {} as JwtService);
    const resetToken = 'a'.repeat(64);
    await expect(service.resetPasswordChange('safe@example.test', 'new-password', resetToken)).resolves.toEqual({ message: 'Password reset successfully' });
    const [query, update, options] = userModel.findOneAndUpdate.mock.calls[0];
    expect(query).toMatchObject({
      email: 'safe@example.test',
      resetTokenHash: createHash('sha256').update(resetToken).digest('hex'),
      resetTokenExpiry: { $gt: expect.any(Date) },
    });
    expect(await bcrypt.compare('new-password', update.$set.password)).toBe(true);
    expect(update.$unset).toHaveProperty('resetTokenHash');
    expect(update.$inc.authVersion).toBe(1);
    expect(options.runValidators).toBe(true);
    await expect(service.resetPasswordChange('safe@example.test', 'other-password', resetToken)).rejects.toThrow('Invalid or expired');
  });

  it('logs successful blog mutations with an authenticated actor, without secret bodies', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = { createBlog: jest.fn().mockResolvedValue({ _id: 'blog-id' }) };
    const controller = new BlogController(service as unknown as BlogService);
    await controller.createBlog({ title: 'Safe', content: 'private-body' }, undefined as any, {
      user: { id: 'admin-id', role: 'admin' },
      headers: { authorization: 'Bearer secret-token' },
    } as any);
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({
      event: 'blog.mutation', action: 'create', blogId: 'blog-id', actorId: 'admin-id', actorRole: 'admin',
    });
    expect(warn.mock.calls[0][0]).not.toContain('secret-token');
    expect(warn.mock.calls[0][0]).not.toContain('private-body');
  });
});
