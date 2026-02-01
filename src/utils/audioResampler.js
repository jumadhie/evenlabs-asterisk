/**
 * Simple audio resampling utilities for real-time audio processing
 * Handles conversion between 8kHz and 16kHz sample rates
 */

/**
 * Upsample audio from 8kHz to 16kHz (linear interpolation)
 * @param {Buffer} input - PCM 16-bit audio at 8kHz
 * @returns {Buffer} - PCM 16-bit audio at 16kHz
 */
function upsample8to16(input) {
  // Each sample is 2 bytes (16-bit)
  const inputSamples = input.length / 2;
  const outputSamples = inputSamples * 2; // Double the sample count
  
  const output = Buffer.alloc(outputSamples * 2);
  
  for (let i = 0; i < inputSamples - 1; i++) {
    const sample1 = input.readInt16LE(i * 2);
    const sample2 = input.readInt16LE((i + 1) * 2);
    
    // Write original sample
    output.writeInt16LE(sample1, i * 4);
    
    // Write interpolated sample (average of current and next)
    const interpolated = Math.floor((sample1 + sample2) / 2);
    output.writeInt16LE(interpolated, i * 4 + 2);
  }
  
  // Handle last sample
  const lastSample = input.readInt16LE((inputSamples - 1) * 2);
  output.writeInt16LE(lastSample, (inputSamples - 1) * 4);
  output.writeInt16LE(lastSample, (inputSamples - 1) * 4 + 2);
  
  return output;
}

/**
 * Downsample audio from 16kHz to 8kHz (simple decimation)
 * @param {Buffer} input - PCM 16-bit audio at 16kHz
 * @returns {Buffer} - PCM 16-bit audio at 8kHz
 */
function downsample16to8(input) {
  // Each sample is 2 bytes (16-bit)
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor(inputSamples / 2);
  
  const output = Buffer.alloc(outputSamples * 2);
  
  for (let i = 0; i < outputSamples; i++) {
    // Take every other sample
    const sample = input.readInt16LE(i * 4);
    output.writeInt16LE(sample, i * 2);
  }
  
  return output;
}

/**
 * Convert PCM to ulaw (simplified G.711 encoding)
 * @param {Buffer} pcm - PCM 16-bit samples
 * @returns {Buffer} - ulaw encoded samples
 */
function pcmToUlaw(pcm) {
  const samples = pcm.length / 2;
  const output = Buffer.alloc(samples);
  
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2);
    output[i] = linearToUlaw(sample);
  }
  
  return output;
}

/**
 * Convert ulaw to PCM (simplified G.711 decoding)
 * @param {Buffer} ulaw - ulaw encoded samples
 * @returns {Buffer} - PCM 16-bit samples
 */
function ulawToPcm(ulaw) {
  const output = Buffer.alloc(ulaw.length * 2);
  
  for (let i = 0; i < ulaw.length; i++) {
    const sample = ulawToLinear(ulaw[i]);
    output.writeInt16LE(sample, i * 2);
  }
  
  return output;
}

// G.711 ulaw encoding table (simplified)
const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

function linearToUlaw(sample) {
  const sign = (sample < 0) ? 0x80 : 0x00;
  let magnitude = Math.abs(sample);
  
  if (magnitude > ULAW_CLIP) {
    magnitude = ULAW_CLIP;
  }
  
  magnitude += ULAW_BIAS;
  
  let exponent = 7;
  for (let exp = 0; exp < 8; exp++) {
    if (magnitude <= (1 << (exp + 7))) {
      exponent = exp;
      break;
    }
  }
  
  const mantissa = (magnitude >> (exponent + 3)) & 0x0F;
  const ulawByte = ~(sign | (exponent << 4) | mantissa);
  
  return ulawByte & 0xFF;
}

function ulawToLinear(ulawByte) {
  ulawByte = ~ulawByte;
  
  const sign = (ulawByte & 0x80);
  const exponent = (ulawByte >> 4) & 0x07;
  const mantissa = ulawByte & 0x0F;
  
  let sample = ((mantissa << 3) + ULAW_BIAS) << exponent;
  sample -= ULAW_BIAS;
  
  return sign ? -sample : sample;
}

module.exports = {
  upsample8to16,
  downsample16to8,
  pcmToUlaw,
  ulawToPcm,
};
