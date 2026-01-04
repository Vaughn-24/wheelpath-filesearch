/**
 * AudioWorkletProcessor for capturing microphone audio
 * Converts Float32 to Int16 PCM and sends to main thread
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; // Match the old ScriptProcessorNode buffer size
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];
    
    // Accumulate samples until we have a full buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];
      
      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send to main thread
        this.port.postMessage({
          type: 'audio',
          data: pcmData.buffer
        }, [pcmData.buffer]);
        
        // Reset buffer
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);

