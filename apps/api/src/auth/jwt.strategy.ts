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
    // [Checkpoint 7] JWT Guard executed - Token extracted
    console.log('[JwtStrategy] validate called', {
      hasToken: !!token,
      tokenLength: token?.length || 0,
      tokenPrefix: token?.substring(0, 20) || 'none',
    });

    try {
      // [Checkpoint 8] Firebase Admin verification
      console.log('[JwtStrategy] Verifying token with Firebase Admin...');
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // [Checkpoint 8.1] Token expiration check
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = decodedToken.exp - now;
      const isExpiringSoon = expiresIn < 300; // Less than 5 minutes remaining
      
      console.log('[JwtStrategy] Token verified successfully', {
        uid: decodedToken.uid,
        email: decodedToken.email || 'none',
        authTime: decodedToken.auth_time,
        exp: decodedToken.exp,
        iat: decodedToken.iat,
        issuer: decodedToken.iss,
        expiresInSeconds: expiresIn,
        isExpiringSoon,
        expiresAt: new Date(decodedToken.exp * 1000).toISOString(),
      });

      if (expiresIn <= 0) {
        console.error('[JwtStrategy] Token already expired', {
          uid: decodedToken.uid,
          expiredAt: new Date(decodedToken.exp * 1000).toISOString(),
          currentTime: new Date().toISOString(),
        });
        throw new UnauthorizedException('Token has expired');
      }

      if (isExpiringSoon) {
        console.warn('[JwtStrategy] Token expiring soon - client should refresh', {
          uid: decodedToken.uid,
          expiresInSeconds: expiresIn,
        });
      }

      // [Checkpoint 9] Tenant ID extraction
      const tenantId = decodedToken.uid;
      console.log('[JwtStrategy] Tenant ID extracted', { tenantId });
      
      // Map Firebase User to Tenant/User Context
      return {
        userId: decodedToken.uid,
        email: decodedToken.email,
        // For MVP, we treat the user UID as the tenant ID (Single User Mode)
        // In a real B2B app, we would look up the user's tenant from Firestore
        tenantId, 
      };
    } catch (err) {
      const errorCode = (err as any)?.code || 'unknown';
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      console.error('[JwtStrategy] Token verification failed', {
        error: err,
        errorMessage,
        errorCode,
        isExpired: errorCode === 'auth/id-token-expired' || errorMessage.includes('expired'),
        isInvalid: errorCode === 'auth/argument-error' || errorCode === 'auth/invalid-id-token',
        stack: err instanceof Error ? err.stack : undefined,
      });
      
      // Provide more specific error messages
      if (errorCode === 'auth/id-token-expired' || errorMessage.includes('expired')) {
        throw new UnauthorizedException('Token has expired. Please refresh your session.');
      }
      if (errorCode === 'auth/argument-error' || errorCode === 'auth/invalid-id-token') {
        throw new UnauthorizedException('Invalid token format');
      }
      
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }
}
