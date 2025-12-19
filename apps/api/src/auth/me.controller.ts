import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';

@Controller('me')
@UseGuards(JwtAuthGuard, TenantGuard)
export class MeController {
  @Get()
  getMe(req: any) {
    const { sub, tenantId, email, role } = (req as any).user || {};
    return { sub, tenantId, email, role };
  }
}
