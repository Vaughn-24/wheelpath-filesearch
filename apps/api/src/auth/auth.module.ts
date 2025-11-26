import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      // Values are validated at runtime; for tests we use a default
      publicKey: process.env.JWT_PUBLIC_KEY,
      secret: process.env.JWT_SECRET,
      signOptions: {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        algorithm: process.env.JWT_PUBLIC_KEY ? 'RS256' : 'HS256',
      },
    }),
  ],
  providers: [JwtStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
