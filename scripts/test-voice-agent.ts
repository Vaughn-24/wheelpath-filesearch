#!/usr/bin/env ts-node

/**
 * Voice Agent Test Script
 * 
 * Tests the voice agent functionality without needing the full frontend.
 * 
 * Usage:
 *   # Test with a simple query
 *   ts-node scripts/test-voice-agent.ts --query "What is the foundation depth?"
 *   
 *   # Test with specific document
 *   ts-node scripts/test-voice-agent.ts --query "What is the foundation depth?" --document-id "doc123"
 *   
 *   # Test streaming response
 *   ts-node scripts/test-voice-agent.ts --query "What is the foundation depth?" --stream
 *   
 *   # Test WebSocket connection
 *   ts-node scripts/test-voice-agent.ts --websocket --query "What is the foundation depth?"
 */

import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as aiplatform from '@google-cloud/aiplatform';

// Dynamic import for socket.io-client (may not be installed)
let io: any;
try {
  const socketIO = require('socket.io-client');
  io = socketIO.io || socketIO.default || socketIO;
} catch (error) {
  // socket.io-client may not be installed at root level
  io = null;
}

// Parse command line arguments
const args = process.argv.slice(2);
const queryIndex = args.indexOf('--query');
const documentIdIndex = args.indexOf('--document-id');
const streamIndex = args.indexOf('--stream');
const websocketIndex = args.indexOf('--websocket');
const tenantIdIndex = args.indexOf('--tenant-id');
const apiUrlIndex = args.indexOf('--api-url');

const query = queryIndex >= 0 ? args[queryIndex + 1] : null;
const documentId = documentIdIndex >= 0 ? args[documentIdIndex + 1] : 'all';
const useStream = streamIndex >= 0;
const useWebSocket = websocketIndex >= 0;
const tenantId = tenantIdIndex >= 0 ? args[tenantIdIndex + 1] : null;
const apiUrl = apiUrlIndex >= 0 ? args[apiUrlIndex + 1] : 'http://localhost:3001';

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  const projectId = process.env.GCP_PROJECT || 'wheelpath-filesearch';
  try {
    admin.initializeApp({
      projectId,
    });
    console.log(`✅ Firebase Admin initialized: ${projectId}`);
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    process.exit(1);
  }
}

// Test VoiceService directly
async function testVoiceServiceDirect(query: string, documentId: string, tenantId: string) {
  console.log('\n🧪 Testing VoiceService directly...\n');
  console.log(`Query: "${query}"`);
  console.log(`Document ID: ${documentId}`);
  console.log(`Tenant ID: ${tenantId}\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({ model: voiceModel });

  console.log(`Using model: ${voiceModel}\n`);

  // Retrieve context (simplified version)
  const firestore = admin.firestore();
  let context = '';

  try {
    console.log('📚 Retrieving context...');
    const hasVectorSearch = 
      process.env.VERTEX_INDEX_ENDPOINT_ID && 
      process.env.VERTEX_DEPLOYED_INDEX_ID && 
      process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN;

    if (hasVectorSearch) {
      // Query Firestore for documents
      const docsSnapshot = await firestore
        .collection('documents')
        .where('tenantId', '==', tenantId)
        .select('id')
        .limit(5)
        .get();

      console.log(`Found ${docsSnapshot.docs.length} documents`);

      if (docsSnapshot.docs.length > 0) {
        // For testing, use a simple context
        context = `Project documents available. User query: ${query}`;
      }
    } else {
      console.log('⚠️  Vector search not configured, using empty context');
    }
  } catch (error) {
    console.error('❌ Context retrieval failed:', error);
  }

  // Build voice system prompt
  const systemPrompt = context
    ? `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

CORE IDENTITY:
You have two superpowers:
1. Finding the right information instantly from project data
2. Turning that information into clear, confident next steps

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented
- Friendly but professional
- Never rushed, never panicked

PROJECT CONTEXT (from user's documents):
${context}

Answer the user's question using ONLY the context above. If the answer isn't in the context, say "I don't have that information in your documents yet."`
    : `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

NOTE: The user hasn't uploaded project documents yet.
- Help with general construction questions
- Encourage them to upload documents for project-specific answers`;

  // Test streaming response
  if (useStream) {
    console.log('📡 Testing streaming response...\n');
    
    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessageStream(query);

    console.log('Response (streaming):\n');
    let fullResponse = '';
    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        process.stdout.write(text);
        fullResponse += text;
      }
    }
    console.log('\n');
    console.log(`\n✅ Stream completed. Total length: ${fullResponse.length} characters`);
  } else {
    console.log('💬 Testing single response...\n');
    
    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(query);
    const response = result.response;
    const text = response.text();

    console.log('Response:\n');
    console.log(text);
    console.log(`\n✅ Response received. Length: ${text.length} characters`);
  }
}

// Test WebSocket connection
async function testWebSocket(query: string, documentId: string, tenantId: string) {
  if (!io) {
    console.error('❌ socket.io-client not installed');
    console.log('   Install with: npm install socket.io-client');
    console.log('   Or test without WebSocket using direct service test');
    process.exit(1);
  }

  console.log('\n🌐 Testing WebSocket connection...\n');
  console.log(`API URL: ${apiUrl}`);
  console.log(`Query: "${query}"`);
  console.log(`Document ID: ${documentId}`);
  console.log(`Tenant ID: ${tenantId}\n`);

  if (!tenantId) {
    console.error('❌ --tenant-id required for WebSocket test');
    console.log('   Example: --tenant-id "test-user-123"');
    process.exit(1);
  }

  // For testing, we'll create a custom token
  let token: string;
  try {
    console.log('🔐 Creating test token...');
    token = await admin.auth().createCustomToken(tenantId);
    console.log('✅ Token created\n');
  } catch (error) {
    console.error('❌ Failed to create token:', error);
    console.log('\n💡 Alternative: Get token from browser console when logged in');
    process.exit(1);
  }

  return new Promise<void>((resolve, reject) => {
    const socket = io(`${apiUrl}/voice`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('✅ WebSocket connected');
      console.log(`   Socket ID: ${socket.id}\n`);
    });

    socket.on('authenticated', (data) => {
      console.log('✅ Authenticated');
      console.log(`   Data:`, JSON.stringify(data, null, 2));
      console.log('\n📤 Setting document...');
      socket.emit('setDocument', { documentId });
    });

    socket.on('documentSet', (data) => {
      console.log('✅ Document set');
      console.log(`   Data:`, JSON.stringify(data, null, 2));
      console.log('\n📤 Sending voice query...');
      socket.emit('voiceQuery', { text: query });
    });

    socket.on('voiceStart', (data) => {
      console.log('✅ Voice query started');
      console.log(`   Data:`, JSON.stringify(data, null, 2));
      console.log('\n📥 Waiting for response...\n');
    });

    socket.on('voiceChunk', (data: { text: string }) => {
      process.stdout.write(data.text);
    });

    socket.on('voiceEnd', (data) => {
      console.log('\n\n✅ Voice response completed');
      console.log(`   Data:`, JSON.stringify(data, null, 2));
      socket.disconnect();
      resolve();
    });

    socket.on('voiceError', (data: { message: string }) => {
      console.error('\n❌ Voice error:', data.message);
      socket.disconnect();
      reject(new Error(data.message));
    });

    socket.on('error', (error) => {
      console.error('\n❌ Socket error:', error);
      socket.disconnect();
      reject(error);
    });

    socket.on('disconnect', () => {
      console.log('\n🔌 WebSocket disconnected');
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      console.error('\n❌ Test timeout after 30 seconds');
      socket.disconnect();
      reject(new Error('Timeout'));
    }, 30000);
  });
}

// Main execution
async function main() {
  console.log('🎤 Voice Agent Test Script\n');
  console.log('=' .repeat(50));

  if (!query) {
    console.error('❌ --query argument required');
    console.log('\nUsage:');
    console.log('  ts-node scripts/test-voice-agent.ts --query "Your question here"');
    console.log('\nOptions:');
    console.log('  --query <text>           Query to test');
    console.log('  --document-id <id>        Document ID (default: "all")');
    console.log('  --tenant-id <id>          Tenant/User ID (required for WebSocket)');
    console.log('  --stream                  Use streaming response');
    console.log('  --websocket               Test via WebSocket');
    console.log('  --api-url <url>           API URL (default: http://localhost:3001)');
    process.exit(1);
  }

  const testTenantId = tenantId || 'test-tenant-' + Date.now();

  try {
    if (useWebSocket) {
      await testWebSocket(query, documentId, testTenantId);
    } else {
      await testVoiceServiceDirect(query, documentId, testTenantId);
    }
    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

