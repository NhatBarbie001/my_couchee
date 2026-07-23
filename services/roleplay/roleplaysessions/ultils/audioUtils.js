'use strict';

const sherpa_onnx = require('sherpa-onnx-node');
const fs = require('fs');
const path = require('path');

// Giá trị mặc định cho cấu hình VAD của Sherpa ONNX, có thể được ghi đè bởi options truyền vào
const VAD_DEFAULTS = {
  threshold: 0.5, // Tăng threshold để giảm false positive
  minSpeechDuration: 0.25, // Tăng thời gian tối thiểu để xác nhận là speech
  minSilenceDuration: 0.5, // Tăng thời gian silence để chắc chắn người dùng đã dừng nói
  windowSize: 512,      // số mẫu (tương đương 32ms ở 16kHz)
  sampleRate: 16000,
  debug: false,
  numThreads: 1,
  bufferSizeInSecondsForVad: 60, // Tăng buffer size để xử lý audio dài hơn
};

/**
 * Chuyển đổi buffer âm thanh PCM 16-bit signed integer sang Float32Array.
 * @param {Buffer} buffer Buffer đầu vào PCM 16-bit.
 * @returns {Float32Array} Mảng Float32.
 */
function pcm16ToFloat32(buffer) {
  if (!buffer || buffer.length === 0) {
    return new Float32Array(0);
  }
  const float32Array = new Float32Array(buffer.length / 2);
  for (let i = 0; i < float32Array.length; i++) {
    // Đọc Int16 Little Endian và chuẩn hóa về khoảng [-1.0, 1.0]
    float32Array[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }
  return float32Array;
}

/**
 * Khởi tạo một instance của Sherpa ONNX VAD.
 * @param {string} modelPath Đường dẫn đến file mô hình .onnx của VAD.
 * @param {object} options Các tùy chọn để cấu hình VAD, sẽ ghi đè giá trị mặc định.
 * @returns {sherpa_onnx.Vad | null} Instance của VAD hoặc null nếu có lỗi.
 */
function createSherpaVadInstance() {
  const modelPath = path.join(__dirname, 'models', 'silero_vad_v6.onnx');
  if (!fs.existsSync(modelPath)) {
    console.error(`Lỗi: Không tìm thấy file mô hình VAD tại: ${modelPath}. VAD sẽ không được khởi tạo.`);
    throw new Error(`Lỗi: Không tìm thấy file mô hình VAD tại: ${modelPath}`);
    return null;
  }

  const sileroVadConfig = {
    model: modelPath,
    threshold: VAD_DEFAULTS.threshold,
    minSpeechDuration: VAD_DEFAULTS.minSpeechDuration,
    minSilenceDuration: VAD_DEFAULTS.minSilenceDuration,
    windowSize: VAD_DEFAULTS.windowSize,
  };

  const vadConfig = {
    sileroVad: sileroVadConfig,
    // tenVad: sileroVadConfig,
    sampleRate: VAD_DEFAULTS.sampleRate,
    debug: VAD_DEFAULTS.debug,
    numThreads: VAD_DEFAULTS.numThreads,
  };

  const bufferSizeInSeconds = VAD_DEFAULTS.bufferSizeInSecondsForVad;

  try {
    console.info('Đang khởi tạo Sherpa ONNX VAD với cấu hình:', JSON.stringify(vadConfig, null, 2));
    const vad = new sherpa_onnx.Vad(vadConfig, bufferSizeInSeconds);
    const preBuffer = [];
    return {vad, preBuffer};
  } catch (e) {
    console.error(`Lỗi khi khởi tạo Sherpa ONNX VAD: ${e.message}. Vui lòng kiểm tra đường dẫn mô hình, file .onnx và các thư viện phụ thuộc của sherpa-onnx-node.`);
    return null;
  }
}

/**
 * Xử lý một frame âm thanh PCM 16-bit để phát hiện giọng nói.
 * @param {sherpa_onnx.Vad | null} sherpaVadInstance Instance của VAD.
 * @param {Buffer} pcm16Buffer Buffer âm thanh PCM 16-bit.
 * @returns {boolean} True nếu phát hiện giọng nói, ngược lại là false.
 */
function processSpeechFrame(sherpaVadInstance, pcm16Buffer) {
  if (!sherpaVadInstance) {
    // console.warn('processSpeechFrame: Sherpa VAD instance is null. Không thể phát hiện giọng nói.');
    return false;
  }
  if (!pcm16Buffer || pcm16Buffer.length === 0) {
    // console.warn('processSpeechFrame: Buffer âm thanh rỗng.');
    return false;
  }

  try {
    const float32Samples = pcm16ToFloat32(pcm16Buffer);
    // VAD của sherpa-onnx là stateful, nó sẽ tích lũy các frame.
    sherpaVadInstance.acceptWaveform(float32Samples);
    // isDetected() sẽ trả về true nếu có giọng nói trong buffer nội bộ của VAD hiện tại.
    return sherpaVadInstance.isDetected();
  } catch (error) {
    console.error('Lỗi trong processSpeechFrame với Sherpa ONNX VAD:', error);
    return false;
  }
}

/**
 * Chuyển đổi mảng Float32Array sang Buffer âm thanh PCM 16-bit signed integer Little Endian.
 * @param {Float32Array} float32Array Mảng Float32 đầu vào (giá trị từ -1.0 đến 1.0).
 * @returns {Buffer} Buffer PCM 16-bit.
 */
function float32ToPcm16(float32Array) {
  if (!float32Array || float32Array.length === 0) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.alloc(float32Array.length * 2);
  for (let i = 0; i < float32Array.length; i++) {
    // Giới hạn giá trị trong khoảng [-1.0, 1.0] để tránh lỗi khi chuyển đổi
    const val = Math.max(-1, Math.min(1, float32Array[i]));
    // Chuyển đổi sang Int16 và ghi vào buffer ở dạng Little Endian
    buffer.writeInt16LE(Math.round(val * 32767), i * 2);
  }
  return buffer;
}

module.exports = {
  pcm16ToFloat32,
  createSherpaVadInstance,
  processSpeechFrame,
  float32ToPcm16,
  VAD_DEFAULTS, // Export để có thể tham chiếu từ bên ngoài nếu cần
};
