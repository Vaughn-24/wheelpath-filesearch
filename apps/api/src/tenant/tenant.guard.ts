import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    // Skip authentication for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return true;
    }
    return super.canActivate(context);
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // Skip tenant check for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return true;
    }
    const user = request.user as { tenantId?: string } | undefined;
    if (!user?.tenantId) {
      throw new UnauthorizedException('Missing tenant in token');
    }
    request.tenantId = user.tenantId;
    return true;
  }
}

declare module 'http' {
  interface IncomingMessage {
    tenantId?: string;
    user?: any;
  }
}
