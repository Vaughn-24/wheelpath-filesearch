/**
 * Audio Utilities for Gemini Live API
 * 
 * Handles conversion between browser audio formats and raw PCM
 * required by Gemini Live API (16kHz input, 24kHz output)
 */

/**
 * Convert AudioBuffer to PCM 16-bit, 16kHz
 */
export async function audioBufferToPCM16(
  audioBuffer: AudioBuffer,
  targetSampleRate: number = 16000
): Promise<Int16Array> {
  // Resample if needed
  const sourceSampleRate = audioBuffer.sampleRate;
  const targetLength = Math.round(audioBuffer.length * (targetSampleRate / sourceSampleRate));
  
  const pcmData = new Int16Array(targetLength);
  const channelData = audioBuffer.getChannelData(0); // Mono
  
  // Simple linear resampling
  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = (i * sourceSampleRate) / targetSampleRate;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;
    
    let sample = 0;
    if (index < channelData.length - 1) {
      // Linear interpolation
      sample = channelData[index] * (1 - fraction) + channelData[index + 1] * fraction;
    } else {
      sample = channelData[index] || 0;
    }
    
    // Convert to 16-bit PCM (little-endian)
    pcmData[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
  }
  
  return pcmData;
}

/**
 * Convert PCM 16-bit, 24kHz to AudioBuffer for playback
 */
export function pcm24ToAudioBuffer(
  pcmData: Int16Array,
  sampleRate: number = 24000
): AudioBuffer {
  const audioContext = new AudioContext({ sampleRate });
  const audioBuffer = audioContext.createBuffer(1, pcmData.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  // Convert from 16-bit PCM to float32 (-1 to 1)
  for (let i = 0; i < pcmData.length; i++) {
    channelData[i] = pcmData[i] / 32768.0;
  }
  
  return audioBuffer;
}

/**
 * Convert base64 PCM string to Int16Array
 */
export function base64ToPCM16(base64: string): Int16Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Convert to Int16Array (little-endian)
  const pcm16 = new Int16Array(bytes.length / 2);
  for (let i = 0; i < pcm16.length; i++) {
    pcm16[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  }
  
  return pcm16;
}

/**
 * Convert Int16Array PCM to base64 string
 */
export function pcm16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.length * 2);
  for (let i = 0; i < pcm16.length; i++) {
    const value = pcm16[i];
    bytes[i * 2] = value & 0xff;
    bytes[i * 2 + 1] = (value >> 8) & 0xff;
  }
  
  // Convert to base64
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Create AudioContext for microphone capture
 */
export function createAudioContext(): AudioContext | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    return new AudioContextClass();
  } catch (error) {
    console.error('Failed to create AudioContext:', error);
    return null;
  }
}

/**
 * Get user media stream (microphone)
 */
export async function getUserMedia(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1, // Mono
        sampleRate: 16000, // Target sample rate
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    console.error('Failed to get user media:', error);
    return null;
  }
}

