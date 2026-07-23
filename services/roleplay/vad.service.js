'use strict';

const audioUtils = require('./roleplaysessions/ultils/audioUtils');

const MAX_TURN_DURATION_DEFAULT = 240000;

function createDefaultSessionState() {
  const {vad: sherpaVadInstance, preBuffer} = audioUtils.createSherpaVadInstance();

  return {
    sherpaVad: sherpaVadInstance,
    preBuffer: preBuffer || [],
    audioBuffer: Buffer.alloc(0),
    isStudentSpeaking: false,
    lastVoiceActivity: Date.now(),
    startTurnTimestamp: null,
    clientAudioFormat: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    },
  };
}

module.exports = {
  name: 'roleplay.vad',

  created() {
    this.sessionStates = new Map();
  },

  actions: {
    process: {
      params: {
        sessionId: {type: 'string'},
        audio: {type: 'any'},
        format: {type: 'object', optional: true},
        silenceThreshold: {type: 'number', optional: true},
        maxTurnDuration: {type: 'number', optional: true},
      },
      async handler(ctx) {
        const {
          sessionId,
          audio,
          format,
          silenceThreshold = 500,
          maxTurnDuration = MAX_TURN_DURATION_DEFAULT,
        } = ctx.params;

        let state = this.sessionStates.get(sessionId);
        if (!state) {
          state = createDefaultSessionState();
          this.sessionStates.set(sessionId, state);
        }

        if (format) {
          state.clientAudioFormat = {
            sampleRate: format.sampleRate || state.clientAudioFormat.sampleRate,
            channels: format.channels || state.clientAudioFormat.channels,
            bitDepth: format.bitsPerSample || format.bitDepth || state.clientAudioFormat.bitDepth,
          };
        }

        if (!audio || audio.length === 0) {
          return {
            speechStarted: false,
            speechEnded: false,
            isStudentSpeaking: state.isStudentSpeaking,
            providerAudioChunks: [],
            vadPopCount: 0,
            startTurnTimestamp: state.startTurnTimestamp,
            lastVoiceActivity: state.lastVoiceActivity,
          };
        }

        const providerAudioChunks = [];
        let vadPopCount = 0;
        let speechStarted = false;
        let speechEnded = false;
        let turnEndReason = null;

        state.audioBuffer = Buffer.concat([state.audioBuffer, audio]);
        const {sampleRate, channels, bitDepth} = state.clientAudioFormat;

        const windowSamples = state.sherpaVad.config?.sileroVad?.windowSize || audioUtils.VAD_DEFAULTS.windowSize;
        const frameBytes = windowSamples * (bitDepth / 8) * channels;

        while (state.audioBuffer.length >= frameBytes) {
          const frame = state.audioBuffer.slice(0, frameBytes);
          state.audioBuffer = state.audioBuffer.slice(frameBytes);

          const floatFrame = audioUtils.pcm16ToFloat32(frame);
          state.sherpaVad.acceptWaveform(floatFrame);
          const audioBufferForSTT = audioUtils.float32ToPcm16(floatFrame);

          if (state.sherpaVad.isDetected()) {
            state.lastVoiceActivity = Date.now();

            if (!state.isStudentSpeaking) {
              state.isStudentSpeaking = true;
              speechStarted = true;
              state.startTurnTimestamp = Date.now();

              for (const preSpeechSample of state.preBuffer) {
                providerAudioChunks.push(preSpeechSample);
              }
              state.preBuffer = [];
            }
          }

          if (state.isStudentSpeaking) {
            providerAudioChunks.push(audioBufferForSTT);
          } else {
            const frameDuration = (windowSamples / sampleRate) * 1000;
            const keepSampleNumber = ((audioUtils.VAD_DEFAULTS.minSpeechDuration * 2) / frameDuration) * 1000;
            state.preBuffer.push(audioBufferForSTT);
            if (state.preBuffer.length > keepSampleNumber) {
              state.preBuffer = state.preBuffer.slice(state.preBuffer.length - keepSampleNumber);
            }
          }

          while (!state.sherpaVad.isEmpty()) {
            state.sherpaVad.pop();
            vadPopCount += 1;
          }
        }

        if (state.isStudentSpeaking) {
          const silenceTime = Date.now() - state.lastVoiceActivity;
          const maxTurnTime = Date.now() - (state.startTurnTimestamp || Date.now());

          if (maxTurnTime > maxTurnDuration) {
            state.isStudentSpeaking = false;
            speechEnded = true;
            turnEndReason = 'max_turn_duration';
          } else if (silenceTime > silenceThreshold) {
            state.isStudentSpeaking = false;
            speechEnded = true;
            turnEndReason = 'silence_threshold';
          }
        }

        return {
          speechStarted,
          speechEnded,
          turnEndReason,
          isStudentSpeaking: state.isStudentSpeaking,
          providerAudioChunks,
          vadPopCount,
          startTurnTimestamp: state.startTurnTimestamp,
          lastVoiceActivity: state.lastVoiceActivity,
        };
      },
    },

    cleanup: {
      params: {
        sessionId: {type: 'string'},
      },
      async handler(ctx) {
        const {sessionId} = ctx.params;
        const hadState = this.sessionStates.has(sessionId);
        this.sessionStates.delete(sessionId);
        return {
          success: true,
          hadState,
        };
      },
    },
  },
};
