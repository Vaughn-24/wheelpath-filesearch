import { Controller, Get, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Simple admin key guard - checks for ADMIN_API_KEY in header
 * In production, use proper admin authentication
 */
class AdminGuard {
  canActivate(context: any): boolean {
    const request = context.switchToHttp().getRequest();
    const adminKey = request.headers['x-admin-key'];
    const expectedKey = process.env.ADMIN_API_KEY;

    if (!expectedKey) {
      // If no admin key configured, deny access
      throw new UnauthorizedException('Admin access not configured');
    }

    if (adminKey !== expectedKey) {
      throw new UnauthorizedException('Invalid admin key');
    }

    return true;
  }
}

@Controller('admin/metrics')
@UseGuards(AdminGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * GET /admin/metrics
   * Returns usage statistics for the specified period
   * 
   * Headers required: x-admin-key: YOUR_ADMIN_API_KEY
   * Query params: days (default: 30)
   * 
   * Example:
   * curl -H "x-admin-key: YOUR_KEY" https://api.example.com/admin/metrics?days=7
   */
  @Get()
  async getMetrics(@Query('days') days?: string) {
    const numDays = parseInt(days || '30', 10);
    return this.metricsService.getStats(numDays);
  }

  /**
   * GET /admin/metrics/today
   * Returns today's usage summary
   */
  @Get('today')
  async getTodayMetrics() {
    return this.metricsService.getStats(1);
  }
}

