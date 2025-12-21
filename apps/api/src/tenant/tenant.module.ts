import { Global, Module } from '@nestjs/common';

import { TenantService } from './tenant.service';

@Global() // Make TenantService available everywhere without importing
@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}

