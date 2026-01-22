import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

export interface PilotSubmission {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  interest?: string;
  submittedAt: string;
  status: 'pending' | 'contacted' | 'onboarded' | 'declined';
  source: 'web' | 'api';
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PilotService {
  private firestore: admin.firestore.Firestore;

  constructor() {
    // Initialize Firebase if not already done
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();
    console.log('PilotService initialized');
  }

  /**
   * Submit a pilot program application
   */
  async submitApplication(data: {
    name: string;
    email: string;
    company: string;
    role: string;
    interest?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<PilotSubmission> {
    // Check for duplicate email submissions
    const existingSubmission = await this.firestore
      .collection('pilot_submissions')
      .where('email', '==', data.email.toLowerCase())
      .limit(1)
      .get();

    if (!existingSubmission.empty) {
      // Return the existing submission instead of creating a duplicate
      const existing = existingSubmission.docs[0].data() as PilotSubmission;
      console.log(`Duplicate pilot submission for email: ${data.email}`);
      return existing;
    }

    // Create new submission
    const submission: PilotSubmission = {
      id: this.firestore.collection('pilot_submissions').doc().id,
      name: data.name.trim(),
      email: data.email.toLowerCase().trim(),
      company: data.company.trim(),
      role: data.role,
      interest: data.interest?.trim() || undefined,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      source: 'web',
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    };

    // Save to Firestore
    await this.firestore
      .collection('pilot_submissions')
      .doc(submission.id)
      .set(submission);

    console.log(`New pilot submission: ${submission.email} from ${submission.company}`);

    return submission;
  }

  /**
   * Get all pilot submissions (for admin use)
   */
  async getAllSubmissions(): Promise<PilotSubmission[]> {
    const snapshot = await this.firestore
      .collection('pilot_submissions')
      .orderBy('submittedAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as PilotSubmission);
  }

  /**
   * Update submission status (for admin use)
   */
  async updateStatus(
    id: string,
    status: PilotSubmission['status'],
  ): Promise<PilotSubmission | null> {
    const docRef = this.firestore.collection('pilot_submissions').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) return null;

    await docRef.update({ status });

    return {
      ...(doc.data() as PilotSubmission),
      status,
    };
  }

  /**
   * Get submission count (for metrics)
   */
  async getSubmissionCount(): Promise<number> {
    const snapshot = await this.firestore.collection('pilot_submissions').count().get();
    return snapshot.data().count;
  }
}
