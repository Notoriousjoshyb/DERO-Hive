import assert from "node:assert";
import { pcmToWhisperWavBase64 } from "./audioWav";

// WAV header: RIFF magic, WAVE format, fmt subchunk, PCM encoding, 16 kHz mono
{
  const samples = new Float32Array(16000);
  const b64 = pcmToWhisperWavBase64(samples, 16000);
  assert(typeof b64 === "string" && b64.length > 0, "returns non-empty string");
  const decoded = Buffer.from(b64, "base64");
  assert(decoded[0] === 0x52 && decoded[1] === 0x49 && decoded[2] === 0x46 && decoded[3] === 0x46, "RIFF");
  assert(decoded[8] === 0x57 && decoded[9] === 0x41 && decoded[10] === 0x56 && decoded[11] === 0x45, "WAVE");
  assert(decoded[12] === 0x66 && decoded[13] === 0x6D && decoded[14] === 0x74 && decoded[15] === 0x20, "fmt");
  assert(decoded[20] === 1 && decoded[21] === 0, "PCM format = 1");
  assert(decoded[22] === 1 && decoded[23] === 0, "mono channel = 1");
  // 16000 = 0x3E80 LE => bytes [0x80, 0x3E, 0x00, 0x00]
  assert(decoded[24] === 0x80 && decoded[25] === 0x3E && decoded[26] === 0x00 && decoded[27] === 0x00, "16 kHz sample rate");
  assert(decoded[34] === 16 && decoded[35] === 0, "16 bits per sample");
}

// 48 kHz input gets downsampled 3:1 (480 -> 160 samples, 320 bytes data => 364 total)
{
  const samples = new Float32Array(480);
  const b64 = pcmToWhisperWavBase64(samples, 48000);
  const decoded = Buffer.from(b64, "base64");
  assert(decoded.length === 364, "48kHz downsampled: expected 364 bytes, got " + decoded.length);
}

// Clipping: values outside [-1,1] are clamped to [-32768, 32767]
{
  const samples = new Float32Array([2, -3, 0.5, -0.5]);
  const b64 = pcmToWhisperWavBase64(samples, 16000);
  const decoded = Buffer.from(b64, "base64");
  assert(decoded.readInt16LE(44) === 32767, "positive 2 -> 32767");
  assert(decoded.readInt16LE(46) === -32768, "negative 3 -> -32768");
}

// byteRate (sampleRate * channels * bytesPerSample) and blockAlign correctness
{
  const samples = new Float32Array(32000);
  const b64 = pcmToWhisperWavBase64(samples, 16000);
  const decoded = Buffer.from(b64, "base64");
  // byteRate = 16000 * 1 * 2 = 32000 LE = [0x00, 0x7D, 0x00, 0x00]
  assert(decoded[28] === 0x00 && decoded[29] === 0x7D && decoded[30] === 0x00 && decoded[31] === 0x00, "byteRate=32000");
  assert(decoded[32] === 2 && decoded[33] === 0, "blockAlign=2");
}

console.log("audioWav.test.ts — all assertions passed");
