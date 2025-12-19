import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-firebase-jwt';
import * as admin from 'firebase-admin';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    });
  }

  async validate(token: string) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Map Firebase User to Tenant/User Context
      return {
        userId: decodedToken.uid,
        email: decodedToken.email,
        // For MVP, we treat the user UID as the tenant ID (Single User Mode)
        // In a real B2B app, we would look up the user's tenant from Firestore
        tenantId: decodedToken.uid, 
      };
    } catch (err) {
      console.error(err);
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }
}
