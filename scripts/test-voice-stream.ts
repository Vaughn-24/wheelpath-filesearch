#!/usr/bin/env ts-node

/**
 * Test Gemini API Streaming Directly
 * 
 * Isolates Gemini API streaming to check if issue is with API or our code.
 * 
 * Usage:
 *   ts-node scripts/test-voice-stream.ts
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

async function testStream() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({ model: modelName });

  console.log('🧪 Testing Gemini API Streaming\n');
  console.log(`Model: ${modelName}`);
  console.log(`API Key: ${apiKey.substring(0, 10)}...\n`);

  const query = process.argv[2] || 'Say hello in one sentence';
  console.log(`Query: "${query}"\n`);

  console.log('📡 Starting stream...\n');
  const startTime = Date.now();

  try {
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessageStream(query);

    console.log('✅ Stream started, waiting for chunks...\n');
    console.log('Response: ');

    let chunkCount = 0;
    let lastChunkTime = Date.now();
    const STREAM_TIMEOUT_MS = 30000; // 30 second timeout

    for await (const chunk of result.stream) {
      const now = Date.now();
      
      // Check for stream timeout (no chunks received)
      if (now - lastChunkTime > STREAM_TIMEOUT_MS) {
        console.error('\n\n❌ Stream timeout - no chunks received for 30 seconds');
        break;
      }

      lastChunkTime = now;
      chunkCount++;

      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        process.stdout.write(text);
      } else {
        console.log(`\n[Chunk ${chunkCount} - no text]`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\n\n✅ Stream completed successfully`);
    console.log(`   Chunks: ${chunkCount}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Avg chunk time: ${chunkCount > 0 ? Math.round(duration / chunkCount) : 0}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n\n❌ Stream failed after ${duration}ms`);
    console.error('Error:', error);
    
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      if (error.stack) {
        console.error('Stack:', error.stack);
      }
    }
    
    process.exit(1);
  }
}

testStream().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

