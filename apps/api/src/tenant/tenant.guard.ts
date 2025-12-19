import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
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
