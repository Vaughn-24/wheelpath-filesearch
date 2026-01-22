import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { PilotService, PilotSubmission } from './pilot.service';

interface SubmitPilotDto {
  name: string;
  email: string;
  company: string;
  role: string;
  interest?: string;
}

@Controller('pilot')
export class PilotController {
  constructor(private readonly pilotService: PilotService) {}

  /**
   * Submit a pilot program application
   * POST /pilot/submit
   * 
   * This endpoint is public (no auth required)
   */
  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  async submitApplication(
    @Body() body: SubmitPilotDto,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string; submission: PilotSubmission }> {
    // Validate required fields
    if (!body.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    if (!this.isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    if (!body.company?.trim()) {
      throw new BadRequestException('Company is required');
    }
    if (!body.role?.trim()) {
      throw new BadRequestException('Role is required');
    }

    // Get IP and user agent for analytics
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString() || undefined;
    const userAgent = req.headers['user-agent'] || undefined;

    const submission = await this.pilotService.submitApplication({
      name: body.name,
      email: body.email,
      company: body.company,
      role: body.role,
      interest: body.interest,
      ipAddress,
      userAgent,
    });

    return {
      success: true,
      message: 'Thank you for joining the pilot program!',
      submission,
    };
  }

  /**
   * Get pilot submission count (public endpoint for display)
   * GET /pilot/count
   */
  @Get('count')
  async getCount(): Promise<{ count: number }> {
    const count = await this.pilotService.getSubmissionCount();
    return { count };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
