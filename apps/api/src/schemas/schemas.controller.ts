import { Controller, Get, Param } from '@nestjs/common';
import rfiSchema from '@wheelpath/schemas/rfi.schema.json';

@Controller('schemas')
export class SchemasController {
  @Get(':docType')
  getSchemaByType(@Param('docType') docType: 'rfi') {
    if (docType === 'rfi') return rfiSchema as unknown;
    return { error: 'Unknown docType' };
  }
}
