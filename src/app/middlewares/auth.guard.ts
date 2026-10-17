import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import config from '../config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../module/user/entities/user.entity';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  authVersion?: number;
  iat?: number;
  exp?: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
  }
}

export default function AuthGuard(...roles: string[]): Type<CanActivate> {
  @Injectable()
  class AuthGuardImpl implements CanActivate {
    constructor(
      readonly jwtService: JwtService,
      @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    ) {}

    async canActivate(
      context: ExecutionContext,
    ): Promise<boolean> {
      const request = context.switchToHttp().getRequest<Request>();
      const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
      if (scheme !== 'Bearer') throw new HttpException('Unauthorized', 401);
      if (!token) throw new HttpException('Unauthorized', 401);

      const decoded = this.jwtService.verify<JwtPayload>(token, {
        secret: config.jwt.accessTokenSecret,
      });
      if (!decoded) throw new HttpException('Unauthorized', 401);

      const user = await this.userModel.findById(decoded.id).select('+authVersion');
      if (
        !user || user.status !== 'active' || user.role !== decoded.role ||
        (user.authVersion ?? 0) !== (decoded.authVersion ?? 0)
      ) {
        throw new HttpException('Unauthorized', 401);
      }

      if (roles.length && !roles.includes(decoded.role)) {
        throw new HttpException('Forbidden', 403);
      }
      request.user = decoded;
      return true;
    }
  }
  return mixin(AuthGuardImpl);
}
