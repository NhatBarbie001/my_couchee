'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const FileMixin = require('../../../mixins/file.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./roleplaysessions.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const path = require('path');
const storageDir = path.join(__dirname, 'storage');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const audioUtils = require('./ultils/audioUtils');
const mongoose = require('mongoose');
const {isFlagEnabled} = require('../../../helpers/featureFlag');
const {createSTTProvider} = require('../stt');
const {stripAudioTags} = require('../utils/audioTagUtils');
const {
  startVoiceTimer,
  endVoiceTimer,
  recordVoiceMetric,
  logFlagDecision,
  markInterruptAttempt: markInterruptAttemptMetric,
  markInterruptSuccess: markInterruptSuccessMetric,
  getInterruptStats,
} = require('../../../helpers/voiceObservability');

const connectionState = new Map();

const createConnectionState = (aiScenario = null) => {
  let {vad: sherpaVadInstance, preBuffer} = audioUtils.createSherpaVadInstance();
  let initialConversationHistory = [];
  if (aiScenario && aiScenario.aiSpeaksFirst && aiScenario.initialAiMessage) {
    initialConversationHistory = [
      {
        role: 'assistant',
        content: aiScenario.initialAiMessage,
      },
    ];
  }

  return {
    audioChunks: [],
    allAudioChunksForSession: [],
    allAiAudioChunksForSession: [],
    audioBuffer: Buffer.alloc(0),
    lastVoiceActivity: Date.now(),
    isProcessingSpeech: false,
    conversationHistory: initialConversationHistory,
    userId: null,
    sessionId: null,
    isSessionActive: false,
    startTime: Date.now(),
    currentTurn: {
      role: null,
      text: '',
      audioChunks: [],
    },
    clientAudioFormat: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    },
    isHandlingChunk: false,
    chunkQueue: [],
    sttStreamId: null,
    isStudentSpeaking: false,
    currentStudentTranscript: '',
    socket: null,
    sherpaVad: sherpaVadInstance,
    preBuffer: preBuffer, // VAD buffer để lưu trữ âm thanh trước khi phát hiện nói
    currentStudentAudioChunks: [],
    currentAiTurnAudioChunks: [],
    isAiResponding: false, // Cờ báo hiệu AI đang trong quá trình phản hồi (LLM hoặc TTS)
    isAiInterruptedByStudent: false, // Cờ báo hiệu AI bị học viên ngắt lời
    turnEndingConfirmation: null, // Để theo dõi quá trình xác nhận kết thúc turn
    startTurnTime: null, // Thời điểm bắt đầu turn hiện tại
    isFinalizingTurn: false, // Guard chống double-finalize (ElevenLabs)
    turnCounter: 0,
    currentTurnId: null,
    activeOrchestratorRunId: null,
    aiTtsStartedTurnId: null,
    voiceFlags: {},
    sttProviderInstance: null,
    sttProviderV2Handle: null,
  };
};

module.exports = {
  name: 'roleplaysessions',
  mixins: [
    DbMongoose(Model),
    FunctionsCommon,
    BaseService,
    FileMixin,
    require('./mixins/roleplayAudio.mixin'),
    require('./mixins/roleplaySTTBase.mixin'),
    require('./mixins/roleplayLLM.mixin'),
    require('./mixins/roleplayGeminiLive.mixin'),
    require('./mixins/roleplaySessionUtil.mixin'),
  ], // Bổ sung audio, STT (base + providers), LLM và sessionUtil mixin

  settings: {
    entityValidator: {},
    populates: {
      createdBy: 'users.get',
      updatedBy: 'users.get',
      studentId: 'users.get',
      taskId: 'tasks.get',
      taskIds: 'tasks.get',
      personaId: 'aipersonas.get',
      recordingId: 'files.get',
      videoRecordingId: 'files.get',
      courseId: 'courses.get',
      analysisId: 'roleplay.analysises.get',
      aiScenarioId: 'aiscenarios.get',
      scenarioSkillIds: 'scenarioskills.get',
    },
    populateOptions: [
      'studentId',
      'taskId',
      'personaId',
      'recordingId',
      'videoRecordingId',
      'courseId',
      'createdBy',
      'updatedBy',
      'analysisId',
      'aiScenarioId',
      'scenarioSkillIds.skillId',
    ],
  },

  hooks: {},
  dependencies: ['roleplay.vad', 'roleplay.orchestrator', 'roleplay.llm'],

  actions: {
    getDetailSession: {
      rest: 'GET /:id/details',
      auth: 'required',
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;
        if (!user || !user._id) {
          throw new MoleculerClientError(i18next.t('error_unauthorized'), 401);
        }

        const session = await this.adapter.findById(id);
        if (!session) {
          throw new MoleculerClientError(i18next.t('error_not_found'), 404);
        }

        // const sessionStudentId = session.studentId ? session.studentId.toString() : null;
        // const currentUserId = user._id.toString();

        // if (!user.isSystemAdmin && sessionStudentId !== currentUserId) {
        //   throw new MoleculerClientError(i18next.t('error_permission_denied'), 403);
        // }

        // Populate the session data
        return await this.transformDocuments(
          ctx,
          {populate: ['courseId', 'courseId.aiPersonaId', 'analysisId', 'aiScenarioId ']},
          session,
        );
      },
    },

    getAllByStudent: {
      rest: ['GET /by-student', 'GET /by-student/:studentIdParam'],
      async handler(ctx) {
        const {
          studentIdParam,
          populate,
          fields,
          page,
          pageSize,
          limit,
          sort,
          search,
          searchFields,
          query,
          courseId,
          taskId,
          status,
        } = ctx.params;

        const user = ctx.meta.user;

        let targetStudentId;

        if (studentIdParam) {
          if (!user || !user.isSystemAdmin) {
            throw new MoleculerClientError(i18next.t('error_permission_denied'), 403);
          }
          targetStudentId = studentIdParam;
        } else {
          if (!user || !user._id) {
            throw new MoleculerClientError(i18next.t('error_unauthorized'), 401);
          }
          targetStudentId = user._id.toString();
        }

        const listQuery = {
          ...(query ? (typeof query === 'string' ? JSON.parse(query) : query) : {}),
          studentId: targetStudentId,
          status: {$in: ['completed', 'analyzed']},
          isDeleted: false,
        };

        if (courseId) {
          listQuery.courseId = courseId;
        }
        if (taskId) {
          listQuery.taskId = taskId;
        }
        if (status) {
          listQuery.status = status;
        }

        const listParams = {
          populate: populate || ['taskId', 'personaId', 'analysisId', 'courseId'],
          fields,
          page,
          limit: +limit || +pageSize || 10,
          sort: sort || '-endTime',
          search,
          query: JSON.stringify(listQuery),
        };

        return ctx.call('roleplaysessions.list', listParams);
      },
    },

    startSession: {
      async handler(ctx) {
        try {
          let {sessionId, socketId, userId, studentId, courseId, aiPersonaId} = ctx.params;

          let courseData = null;
          let scenarioSkills = [];
          let scenarioSkillIds = [];
          let aiScenario = null;

          if (!aiPersonaId) {
            throw new MoleculerClientError('Thiếu thông tin aiPersonaId', 400);
          }

          if (courseId) {
            try {
              courseData = await this.broker.call('courses.get', {id: courseId});
              if (!courseData) {
                this.logger.warn(`Không tìm thấy courseData cho courseId ${courseId}.`);
              } else {
                // Kiểm tra khóa học có đang hoạt động không
                if (courseData.isDeleted) {
                  throw new MoleculerClientError('Khóa học không tồn tại.', 404);
                }
                if (!courseData.isActive) {
                  throw new MoleculerClientError('Khóa học hiện không hoạt động.', 403);
                }
                // Kiểm tra user có quyền truy cập khóa học không
                const checkUserId = studentId || (ctx.meta.user ? ctx.meta.user._id.toString() : null);
                if (checkUserId && courseData.publishedToUsers) {
                  const hasAccess = courseData.publishedToUsers.some(entry => {
                    const uid = entry?._id?.toString() || entry?.userId?._id?.toString() || entry?.userId?.toString();
                    return uid === checkUserId;
                  });
                  if (!hasAccess) {
                    throw new MoleculerClientError('Bạn không có quyền truy cập khóa học này.', 403);
                  }
                }

                try {
                  const scenarios = await this.broker.call('aiscenarios.getDetailAIScenarioByCourse', {courseId});
                  aiScenario = scenarios.find(scenario => {
                    const scenarioPersonaId =
                      typeof scenario.aiPersonaId === 'object' && scenario.aiPersonaId._id
                        ? scenario.aiPersonaId._id.toString()
                        : scenario.aiPersonaId.toString();
                    return scenarioPersonaId === aiPersonaId.toString();
                  });

                  if (aiScenario) {
                    try {
                      scenarioSkills = await this.broker.call('scenarioskills.getSkillsByScenario', {
                        scenarioId: aiScenario._id.toString(),
                      });
                      scenarioSkillIds = scenarioSkills.map(ss => ss._id.toString());
                    } catch (skillErr) {
                      this.logger.error(`Lỗi khi lấy skills cho scenario ${aiScenario._id}:`, skillErr);
                    }
                  } else {
                    this.logger.warn(
                      `Không tìm thấy AI scenario với aiPersonaId ${aiPersonaId} cho course ${courseId}`,
                    );
                  }
                } catch (scenarioErr) {
                  this.logger.error(`Lỗi khi lấy AI scenarios cho courseId ${courseId}:`, scenarioErr);
                }
              }
            } catch (err) {
              this.logger.error(`Lỗi khi lấy courseData cho courseId ${courseId}:`, err);
            }
          }

          if (!aiScenario) {
            throw new MoleculerClientError('Không tìm thấy AI scenario phù hợp cho phiên roleplay.', 400);
          }

          const actingUserId = studentId || (ctx.meta.user ? ctx.meta.user._id.toString() : null);
          const createdById = studentId || (ctx.meta.user ? ctx.meta.user._id.toString() : null);

          if (!actingUserId) {
            throw new MoleculerClientError('Không xác định được người dùng.', 400);
          }

          const sessionEntity = await this.adapter.insert({
            clientSessionId: sessionId,
            userId: actingUserId,
            personaId: aiPersonaId,
            socketId,
            startedAt: new Date(),
            isActive: true,
            studentId: studentId,
            createdBy: createdById,
            courseId,
            scenarioSkillIds,
            aiScenarioId: aiScenario?._id,
          });

          if (connectionState.has(socketId)) {
            const state = connectionState.get(socketId);
            state.sessionId = sessionEntity._id.toString();
            state.userId = actingUserId;
            state.isSessionActive = true;
            state.courseId = courseId;
            state.courseData = courseData;
            state.scenarioSkills = scenarioSkills;
            state.personaId = aiPersonaId;
            state.aiScenarioId = aiScenario?._id;
            state.scenario = aiScenario;
          }

          return {success: true, session: sessionEntity};
        } catch (error) {
          this.logger.error('Lỗi khi bắt đầu phiên roleplay:', error);
          if (error instanceof MoleculerClientError) throw error;
          throw new MoleculerClientError('Lỗi máy chủ khi bắt đầu phiên roleplay.', 500);
        }
      },
    },

    endSession: {
      async handler(ctx) {
        try {
          const {sessionId, socketId, reason} = ctx.params;

          const sessionEntity = await this.adapter.findById(sessionId);
          if (!sessionEntity) {
            const stateFromMap = connectionState.get(socketId);
            if (stateFromMap && stateFromMap.isSessionActive) {
              if (stateFromMap.allAudioChunksForSession && stateFromMap.allAudioChunksForSession.length > 0) {
                try {
                  await this.saveAudioFile(stateFromMap); // Gọi saveAudioFile nếu có audio
                } catch (e) {
                  this.logger.error(`Lỗi khi cố gắng lưu audio cho session (không tìm thấy DB) ${sessionId}:`, e);
                }
              }
            }
            return {
              success: true,
              message: 'Session not found in DB or already ended, audio processing may be based on transient state.',
            };
          }

          const state = connectionState.get(socketId);
          let recordingFileId = null;
          let aiRecordingFileId = null;
          if (state && state.sessionId === sessionId.toString()) {
            try {
              const userInfo = await this.saveAudioFile(state);
              recordingFileId = userInfo?.fileId || null;
            } catch (e) {
              this.logger.error(`Lỗi lưu audio người dùng trong endSession: ${sessionId}`, e);
            }
            try {
              const aiInfo = await this.saveAiAudioFile(state);
              aiRecordingFileId = aiInfo?.fileId || null;
            } catch (e) {
              this.logger.error(`Lỗi lưu audio AI trong endSession: ${sessionId}`, e);
            }

            // Chờ các tác vụ lưu audio ngầm hoàn thành trước khi lấy transcripts
            if (state.pendingAudioSaves && state.pendingAudioSaves.length > 0) {
              try {
                this.logger.info(
                  `Đang chờ ${state.pendingAudioSaves.length} tác vụ lưu audio ngầm hoàn thành trước khi build transcripts cho session ${sessionId}...`,
                );
                await Promise.allSettled(state.pendingAudioSaves);
              } catch (e) {
                this.logger.error('Lỗi khi chờ tác vụ lưu audio ngầm trong endSession:', e);
              }
            }
          }

          const endTime = new Date();
          const duration = this.calculateSessionDuration(sessionEntity.startedAt, endTime);
          const transcripts = this.buildSessionTranscripts(connectionState.get(socketId));

          await this.adapter.updateById(sessionEntity._id, {
            $set: {
              status: 'completed',
              endTime,
              duration,
              isCompleted: true,
              transcripts,
              aiRecordingId: aiRecordingFileId,
            },
          });

          const updatedSession = await this.adapter.findById(sessionEntity._id);
          this.broker.emit('roleplay.session.completed_for_analysis', {
            sessionId: sessionEntity._id.toString(),
            sessionData: updatedSession,
          });
          connectionState.delete(socketId);
          return {success: true, session: updatedSession};
        } catch (error) {
          this.logger.error('Lỗi khi kết thúc phiên roleplay:', error);
          throw error;
        }
      },
    },

    handleDisconnectedSession: {
      visibility: 'private',
      async handler(ctx) {
        const {sessionId, socketId, state} = ctx.params; // sessionId là state.sessionId (_id của DB)

        const sessionEntity = await this.adapter.findById(sessionId);

        if (sessionEntity && sessionEntity.isActive) {
          await this.adapter.updateById(sessionEntity._id, {
            $set: {
              isActive: false,
              endedAt: new Date(),
              endReason: 'client_disconnected',
            },
          });
        } else if (sessionEntity && !sessionEntity.isActive) {
          this.logger.info(`Phiên ${sessionId} đã được đánh dấu là không hoạt động trước đó.`);
        } else {
          this.logger.warn(`Phiên ${sessionId} không tìm thấy trong DB khi xử lý ngắt kết nối cho socket ${socketId}.`);
        }

        if (state && state.allAudioChunksForSession && state.allAudioChunksForSession.length > 0) {
          try {
            await this.saveAudioFile(state);
          } catch (saveError) {
            this.logger.error(`Lỗi khi lưu audio của người dùng cho phiên bị ngắt kết nối ${sessionId}:`, saveError);
          }
        }

        if (state && state.allAiAudioChunksForSession && state.allAiAudioChunksForSession.length > 0) {
          try {
            await this.saveAiAudioFile(state);
          } catch (saveError) {
            this.logger.error(`Lỗi khi lưu audio của AI cho phiên bị ngắt kết nối ${sessionId}:`, saveError);
          }
        }
        return {success: true};
      },
    },

    executeOrchestratedTurn: {
      params: {
        sessionId: {type: 'string'},
        runId: {type: 'string'},
        transcript: {type: 'string', optional: true},
        source: {type: 'string', optional: true},
        turnId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, runId, source = 'runtime'} = ctx.params;
        const state = this.findStateBySessionId(sessionId);

        if (!state || !state.isSessionActive || !state.socket) {
          this.logger.warn(`[${sessionId}] executeOrchestratedTurn skipped: state/session/socket not ready`);
          return {success: false, skipped: true};
        }

        state.activeOrchestratorRunId = runId;
        state.isAiInterruptedByStudent = false;

        await this.processLLMAndResponse(state, state.socket, {
          runId,
          source,
        });

        return {success: true};
      },
    },

    getLLMRuntimePayload: {
      params: {
        sessionId: {type: 'string'},
        runId: {type: 'string', optional: true},
        transcript: {type: 'string', optional: true},
        source: {type: 'string', optional: true},
        turnId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, runId = null, transcript = '', source = 'runtime', turnId = null} = ctx.params;
        const state = this.findStateBySessionId(sessionId);

        if (!state || !state.isSessionActive || !state.socket) {
          this.logger.warn(`[${sessionId}] getLLMRuntimePayload skipped: state/session/socket not ready`);
          return {success: false, skipped: true, reason: 'state_not_ready'};
        }

        state.activeOrchestratorRunId = runId;
        state.isAiInterruptedByStudent = false;
        state.isAiResponding = true;
        state.aiTtsStartedTurnId = null;
        state.currentAiTurnAudioChunks = [];

        const runtimeTurnId = turnId || state.currentTurnId || this.nextTurnId(state);
        state.currentTurnId = runtimeTurnId;

        // Fix P1: Defensive credential extraction — re-fetch nếu apiKey/endpoint vẫn thiếu
        let model = state.persona?.llmModelId?.gptModel;
        let modelInterface = state.persona?.llmModelId?.apiKeyId?.modelInterface || 'AzureOpenAI';
        let endpoint = state.persona?.llmModelId?.apiKeyId?.endpoint;
        let apiKey = state.persona?.llmModelId?.apiKeyId?.apiKey;

        if (!apiKey || !endpoint) {
          this.logger.warn(`[${sessionId}] getLLMRuntimePayload: apiKey/endpoint missing — attempting re-fetch`, {
            hasPersona: !!state.persona,
            hasLlmModelId: !!state.persona?.llmModelId,
            hasApiKeyId: !!state.persona?.llmModelId?.apiKeyId,
            apiKeySet: !!apiKey,
            endpointSet: !!endpoint,
          });

          try {
            const personaId = state.persona?._id?.toString() || state.personaId;
            if (personaId) {
              const freshPersona = await this.broker.call('aipersonas.get', {
                id: personaId,
                populate: ['llmModelId', 'voiceId', 'voiceId.apiKeyId'],
              }).catch(() => null);

              if (freshPersona) {
                // Nếu llmModelId đã resolve thành object nhưng apiKeyId vẫn là ID → fetch riêng
                const rawLlmModel = freshPersona.llmModelId;
                if (rawLlmModel && typeof rawLlmModel !== 'string') {
                  const rawApiKeyId = rawLlmModel.apiKeyId;
                  if (rawApiKeyId && (typeof rawApiKeyId === 'string' || !rawApiKeyId.apiKey)) {
                    const apiKeyIdStr = typeof rawApiKeyId === 'string' ? rawApiKeyId : rawApiKeyId.toString();
                    const freshApiKey = await this.broker.call('apikeys.get', {id: apiKeyIdStr}).catch(() => null);
                    if (freshApiKey) {
                      rawLlmModel.apiKeyId = freshApiKey;
                    }
                  }
                }

                state.persona = freshPersona;
                model = freshPersona?.llmModelId?.gptModel;
                modelInterface = freshPersona?.llmModelId?.apiKeyId?.modelInterface || 'AzureOpenAI';
                endpoint = freshPersona?.llmModelId?.apiKeyId?.endpoint;
                apiKey = freshPersona?.llmModelId?.apiKeyId?.apiKey;

                this.logger.info(`[${sessionId}] getLLMRuntimePayload re-fetch ok`, {
                  apiKeySet: !!apiKey,
                  endpointSet: !!endpoint,
                  modelInterface,
                });
              }
            }
          } catch (refetchErr) {
            this.logger.error(`[${sessionId}] getLLMRuntimePayload re-fetch failed:`, refetchErr?.message);
          }

          // Nếu vẫn thiếu credentials sau re-fetch → fail early với lỗi rõ ràng
          if (!apiKey || !endpoint) {
            this.logger.error(`[${sessionId}] getLLMRuntimePayload: credentials still missing after re-fetch — aborting turn`);
            state.isAiResponding = false;
            if (state.socket) {
              state.socket.emit('server:error', {
                sessionId,
                message: 'Lỗi cấu hình AI: Thiếu API credentials. Vui lòng liên hệ quản trị viên.',
                code: 'LLM_CREDENTIALS_MISSING',
              });
            }
            return {success: false, skipped: true, reason: 'llm_credentials_missing'};
          }
        }

        const maxTokens = model && model.includes('gpt-5.4') ? 300 : 300;

        const systemMessages = state.conversationHistory.filter(msg => msg && msg.role === 'system' && msg.content);
        const systemPrompt = systemMessages.length > 0 ? systemMessages.map(msg => msg.content).join('\n\n') : '';
        const history = state.conversationHistory.filter(msg => msg && msg.role !== 'system');

        this.startVoicePhaseTimer(state, 'llm.first_token', runtimeTurnId);
        if (state.socket) {
          state.socket.emit('server:ai_processing_started', {sessionId: state.sessionId});
        }

        return {
          sessionId,
          transcript,
          history,
          turnId: runtimeTurnId,
          meta: {
            runId,
            source,
            system: systemPrompt,
            model,
            modelInterface,
            endpoint,
            apiKey,
            maxTokens,
            ttsMeta: {
              voiceId: state.persona?.voiceId?._id?.toString(),
              voiceData: state.persona?.voiceId,
              paramInstructions: state.persona?.conversationStyle,
              format: 'pcm',
            },
          },
        };
      },
    },

    pushTTSAudioFromLLM: {
      params: {
        sessionId: {type: 'string'},
        sentence: {type: 'string', min: 1},
        turnId: {type: 'string', optional: true},
        sentenceIndex: {type: 'number', optional: true},
        runId: {type: 'string', optional: true},
        audio: {type: 'any'},
        sampleRate: {type: 'number', optional: true},
      },
      async handler(ctx) {
        const {sessionId, sentence, turnId = null, runId = null, audio, sampleRate = 0} = ctx.params;
        console.log('sentence', sentence);
        const state = this.findStateBySessionId(sessionId);

        if (!state || !state.isSessionActive || !state.socket) {
          return {success: false, skipped: true, reason: 'state_not_ready'};
        }

        if (runId && state.activeOrchestratorRunId && state.activeOrchestratorRunId !== runId) {
          return {success: false, skipped: true, reason: 'run_mismatch'};
        }

        if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
          return {success: false, skipped: true, reason: 'interrupted'};
        }

        let audioBuff = audio;
        if (audioBuff && audioBuff.type === 'Buffer' && Array.isArray(audioBuff.data)) {
          audioBuff = Buffer.from(audioBuff.data);
        }

        if (!audioBuff || !Buffer.isBuffer(audioBuff) || audioBuff.length === 0) {
          return {success: true, audioBytes: 0};
        }

        state.currentTurnId = turnId || state.currentTurnId;

        if (state.aiTtsStartedTurnId !== state.currentTurnId) {
          state.socket.emit('server:ai_tts_started', {sessionId: state.sessionId});
          state.aiTtsStartedTurnId = state.currentTurnId;
        }

        let providerConfig = null;
        if (sampleRate) {
          providerConfig = {sampleRate, channels: 1, bitDepth: 16};
        } else {
          const provider = state.voiceProvider || state.persona?.provider || 'default';
          providerConfig = this.getAudioConfig(provider);
        }

        state.socket.emit('server:ai_text_response', {
          sessionId: state.sessionId,
          text: stripAudioTags(sentence.trim()),
          role: 'assistant',
          isFinal: true,
          turnId: state.currentTurnId,
        });

        const ref = {value: false};
        await this.streamAudioWithRateControl(state, audioBuff, state.socket, state.currentTurnId, ref, providerConfig);

        if (ref.value) {
          return {success: false, skipped: true, reason: 'interrupted_during_stream'};
        }

        state.currentAiTurnAudioChunks.push(audioBuff);
        return {success: true, audioBytes: audioBuff.length};
      },
    },

    speakSentence: {
      params: {
        sessionId: {type: 'string'},
        sentence: {type: 'string', min: 1},
        turnId: {type: 'string'},
        sentenceIndex: {type: 'number', optional: true},
        runId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, sentence, turnId, runId = null} = ctx.params;
        const state = this.findStateBySessionId(sessionId);

        if (!state || !state.isSessionActive || !state.socket) {
          return {success: false, skipped: true, reason: 'state_not_ready'};
        }

        if (runId && state.activeOrchestratorRunId && state.activeOrchestratorRunId !== runId) {
          return {success: false, skipped: true, reason: 'run_mismatch'};
        }

        if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
          return {success: false, skipped: true, reason: 'interrupted'};
        }

        state.currentTurnId = turnId || state.currentTurnId;

        if (state.socket && state.aiTtsStartedTurnId !== state.currentTurnId) {
          state.socket.emit('server:ai_tts_started', {sessionId: state.sessionId});
          state.aiTtsStartedTurnId = state.currentTurnId;
        }

        const audioBuff = await this.processSingleSentenceToSpeech(state, sentence, state.socket);
        if (audioBuff && Buffer.isBuffer(audioBuff) && audioBuff.length > 0) {
          state.currentAiTurnAudioChunks.push(audioBuff);
          return {success: true, audioBytes: audioBuff.length};
        }

        return {success: true, audioBytes: 0};
      },
    },

    completeLLMRuntimeTurn: {
      params: {
        sessionId: {type: 'string'},
        runId: {type: 'string', optional: true},
        turnId: {type: 'string', optional: true},
        response: {type: 'string', optional: true},
        updatedHistory: {type: 'array', optional: true},
        sentencesDispatched: {type: 'number', optional: true},
        aiInitiatedEnd: {type: 'boolean', optional: true},
        // Fix P2: flag dùng bởi orchestrator khi có lỗi để cleanup state và emit server:error
        _errorCleanup: {type: 'boolean', optional: true},
      },
      async handler(ctx) {
        const {
          sessionId,
          runId = null,
          turnId = null,
          response = '',
          updatedHistory: _updatedHistory = [],
          sentencesDispatched: _sentencesDispatched = 0,
          aiInitiatedEnd = false,
          _errorCleanup = false,
        } = ctx.params;
        const state = this.findStateBySessionId(sessionId);

        // Fix P2: Nếu orchestrator gọi để cleanup sau lỗi, reset state và emit error
        if (_errorCleanup) {
          if (state && state.socket) {
            state.socket.emit('server:error', {
              sessionId,
              message: 'Đã xảy ra lỗi khi xử lý phản hồi AI. Vui lòng thử lại.',
              code: 'ORCHESTRATOR_TURN_FAILED',
            });
          }
          if (state) {
            state.isAiResponding = false;
            state.isAiInterruptedByStudent = false;
            state.aiTtsStartedTurnId = null;
            state.currentAiTurnAudioChunks = [];
            state.activeOrchestratorRunId = null;
            this.endVoicePhaseTimer(state, 'llm.first_token', turnId || state.currentTurnId);
            this.endVoicePhaseTimer(state, 'turn.e2e', turnId || state.currentTurnId);
          }
          return {success: false, reason: 'error_cleanup'};
        }

        if (!state || !state.isSessionActive || !state.socket) {
          return {success: false, skipped: true, reason: 'state_not_ready'};
        }

        if (runId && state.activeOrchestratorRunId && state.activeOrchestratorRunId !== runId) {
          return {success: false, skipped: true, reason: 'run_mismatch'};
        }

        const llmLatency = this.endVoicePhaseTimer(state, 'llm.first_token', turnId || state.currentTurnId);
        if (typeof llmLatency === 'number') {
          this.recordVoiceBaselineMetric(
            'llm.first_token.latency',
            llmLatency,
            state.sessionId,
            turnId || state.currentTurnId,
          );
        }

        const fullText = String(response || '').trim();
        if (fullText && !state.isAiInterruptedByStudent) {
          let turnAudioId = null;
          let turnDuration = 0;

          if (state.currentAiTurnAudioChunks.length > 0) {
            const info = await this.saveAiTurnAudio(state, [...state.currentAiTurnAudioChunks]);
            if (info && info.fileId) {
              turnAudioId = info.fileId;
              turnDuration = info.duration || 0;
            }
          }

          state.conversationHistory.push({
            role: 'assistant',
            content: fullText,
            turnAudioId,
            duration: turnDuration,
            speakSpeed: turnDuration > 0 ? fullText.split(/\s+/).length / turnDuration : 0,
          });

          state.socket.emit('server:ai_response_completed', {
            sessionId: state.sessionId,
            fullText,
            turnAudioId,
            duration: turnDuration,
          });
        }

        state.socket.emit('server:ai_tts_completed', {sessionId: state.sessionId});

        const e2eLatency = this.endVoicePhaseTimer(state, 'turn.e2e', turnId || state.currentTurnId);
        if (typeof e2eLatency === 'number') {
          this.recordVoiceBaselineMetric(
            'turn.e2e.latency',
            e2eLatency,
            state.sessionId,
            turnId || state.currentTurnId,
            {
              interrupted: !!state.isAiInterruptedByStudent,
            },
          );
        }

        if (aiInitiatedEnd && state.socket) {
          state.socket.emit('server:ai_end_conversation', {
            sessionId: state.sessionId,
            reason: 'conversation_complete',
            summary: fullText,
            timestamp: new Date(),
          });
        }

        state.isAiResponding = false;
        state.isAiInterruptedByStudent = false;
        state.aiTtsStartedTurnId = null;
        state.currentAiTurnAudioChunks = [];
        state.activeOrchestratorRunId = null;

        return {success: true};
      },
    },

    interruptSessionRuntime: {
      params: {
        sessionId: {type: 'string'},
        reason: {type: 'string', optional: true},
        runId: {type: 'string', optional: true},
        noActiveJob: {type: 'boolean', optional: true},
      },
      async handler(ctx) {
        const {sessionId, reason = 'interrupt', runId = null, noActiveJob = false} = ctx.params;
        const state = this.findStateBySessionId(sessionId);

        if (!state) {
          return {success: false, skipped: true, reason: 'state_not_found'};
        }

        state.isAiInterruptedByStudent = true;
        state.activeOrchestratorRunId = null;
        state.aiTtsStartedTurnId = null;

        if (state.isAiResponding) {
          this.markInterruptAttempt(state);
          this.markInterruptSuccess(state);
        }

        if (state.socket) {
          state.socket.emit('server:ai_speech_interrupted', {
            sessionId,
            turnId: state.currentTurnId || runId || 'na',
            reason,
            noActiveJob,
          });
        }

        return {
          success: true,
          interrupted: true,
          reason,
          runId,
          noActiveJob,
        };
      },
    },

    aggregateSkillStats: {
      visibility: 'public',
      params: {
        studentId: 'string',
        query: {type: 'object', optional: true},
        skillIds: {type: 'array', items: 'string', optional: true},
        scenarioIds: {type: 'array', items: 'string', optional: true},
        groupFormat: {type: 'string', optional: true, default: '%Y-%m-%d'},
      },
      async handler(ctx) {
        const {studentId, query, skillIds, scenarioIds, groupFormat} = ctx.params;

        const matchStage = {
          studentId: new mongoose.Types.ObjectId(studentId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
        };

        // Merge query date filters
        if (query) {
          if (query.createdAt) {
            matchStage.createdAt = {};
            if (query.createdAt.$gte) matchStage.createdAt.$gte = new Date(query.createdAt.$gte);
            if (query.createdAt.$lte) matchStage.createdAt.$lte = new Date(query.createdAt.$lte);
          }
        }

        if (scenarioIds && scenarioIds.length > 0) {
          matchStage.aiScenarioId = {$in: scenarioIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},
          {$project: {analysisId: 1, createdAt: 1}},
          {
            $lookup: {
              from: 'RolePlayAnalysis',
              localField: 'analysisId',
              foreignField: '_id',
              as: 'analysis',
            },
          },
          {$unwind: '$analysis'},
          {$unwind: '$analysis.result.knowledgeAnalysis.skillAnalyses'},
          {
            $project: {
              skillId: '$analysis.result.knowledgeAnalysis.skillAnalyses.skillId',
              score: '$analysis.result.knowledgeAnalysis.skillAnalyses.score',
              createdAt: 1,
            },
          },
        ];

        // Filter by skillIds if provided
        if (skillIds && skillIds.length > 0) {
          const skillObjectIds = skillIds.map(id => new mongoose.Types.ObjectId(id));
          pipeline.push({
            $match: {
              skillId: {$in: skillObjectIds},
            },
          });
        }

        // Project dateKey and Group - use $dateTrunc for proper date grouping
        // Determine unit based on groupFormat
        let truncUnit = 'day';
        if (groupFormat === '%Y-%m') truncUnit = 'month';
        else if (groupFormat === '%Y-%U') truncUnit = 'week';

        pipeline.push(
          {
            $addFields: {
              periodStart: {
                $dateTrunc: {
                  date: '$createdAt',
                  unit: truncUnit,
                  timezone: '+07:00',
                  ...(truncUnit === 'week' ? {startOfWeek: 'sunday'} : {}),
                },
              },
            },
          },
          {
            $project: {
              skillId: 1,
              score: 1,
              dateKey: {
                $dateToString: {format: '%Y-%m-%d', date: '$periodStart', timezone: '+07:00'},
              },
            },
          },
          {
            $group: {
              _id: {skillId: '$skillId', dateKey: '$dateKey'},
              sum: {$sum: '$score'},
              count: {$sum: 1},
            },
          },
          {
            $group: {
              _id: '$_id.skillId',
              dailyScores: {
                $push: {
                  dateKey: '$_id.dateKey',
                  sum: '$sum',
                  count: '$count',
                },
              },
            },
          },
        );

        try {
          const result = await this.adapter.model.aggregate(pipeline);
          return result;
        } catch (error) {
          this.logger.error('Error in aggregateSkillStats:', error);
          throw new MoleculerClientError('Aggregation failed', 500, 'AGGREGATION_ERROR', {error: error.message});
        }
      },
    },

    aggregateCompletedSessions: {
      visibility: 'public',
      params: {
        courseIds: {type: 'array', items: 'string'},
        studentId: {type: 'string', optional: true},
        dateFilter: {type: 'object', optional: true},
      },
      async handler(ctx) {
        const {courseIds, studentId, dateFilter} = ctx.params;

        if (!courseIds || courseIds.length === 0) {
          return {allSessions: [], userSessions: []};
        }

        try {
          const courseObjectIds = courseIds.map(id => new mongoose.Types.ObjectId(id));
          const studentObjectId = studentId ? new mongoose.Types.ObjectId(studentId) : null;

          const matchStage = {
            courseId: {$in: courseObjectIds},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true, $ne: null},
          };

          // Áp dụng dateFilter nếu có (dạng {createdAt: {$gte, $lte}})
          if (dateFilter) {
            Object.assign(matchStage, dateFilter);
          }

          const pipeline = [
            {
              $match: matchStage,
            },
            {
              $lookup: {
                from: 'RolePlayAnalysis',
                localField: 'analysisId',
                foreignField: '_id',
                pipeline: [{$project: {'result.simulationScore': 1}}],
                as: 'analysis',
              },
            },
            {
              $unwind: {
                path: '$analysis',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $group: {
                _id: {
                  courseId: '$courseId',
                  studentId: '$studentId',
                  aiScenarioId: '$aiScenarioId',
                },
                bestScore: {$max: '$analysis.result.simulationScore'},
              },
            },
            {
              $project: {
                _id: 0,
                courseId: '$_id.courseId',
                studentId: '$_id.studentId',
                aiScenarioId: '$_id.aiScenarioId',
                bestScore: 1,
              },
            },
          ];

          const allResults = await this.adapter.model.aggregate(pipeline);

          let userSessions = [];
          if (studentObjectId) {
            const studentIdStr = studentObjectId.toString();
            userSessions = allResults.filter(r => r.studentId?.toString() === studentIdStr);
          }

          return {
            allSessions: allResults,
            userSessions: userSessions,
          };
        } catch (error) {
          this.logger.error('Error in aggregateCompletedSessions:', error);
          throw new MoleculerClientError('Aggregation failed', 500, 'AGGREGATION_ERROR', {error: error.message});
        }
      },
    },

    aggregate: {
      params: {
        pipeline: {type: 'array'},
      },
      async handler(ctx) {
        try {
          return await this.adapter.model.aggregate(ctx.params.pipeline);
        } catch (error) {
          this.logger.error('Aggregation error:', error);
          throw new MoleculerClientError('Aggregation failed', 500, 'AGGREGATION_ERROR', {error: error.message});
        }
      },
    },

    uploadSessionVideo: {
      async handler(ctx) {
        try {
          const user = ctx.meta.user;
          if (!user || !user._id) {
            throw new MoleculerClientError(i18next.t('error_unauthorized'), 401);
          }

          // Multipart upload: metadata gửi qua ctx.meta.$multipart, file stream qua ctx.params
          const multipartData = ctx.meta.$multipart || {};
          const sessionId = multipartData.sessionId;
          const turnMarkersRaw = multipartData.turnMarkers;
          const mimetype = ctx.meta.mimetype || multipartData.mimetype || 'video/webm';
          const originalFilename = ctx.meta.filename || 'roleplay_video.webm';

          if (!sessionId) {
            throw new MoleculerClientError('sessionId is required in multipart data.', 400);
          }

          const session = await this.adapter.findById(sessionId);
          if (!session) {
            throw new MoleculerClientError(i18next.t('error_not_found'), 404);
          }

          // Parse turn markers nếu gửi dưới dạng JSON string
          let turnMarkers = [];
          if (turnMarkersRaw) {
            try {
              turnMarkers = typeof turnMarkersRaw === 'string' ? JSON.parse(turnMarkersRaw) : turnMarkersRaw;
            } catch (e) {
              this.logger.warn('[uploadSessionVideo] Invalid turnMarkers JSON:', e.message);
            }
          }

          const userId = session.studentId ? session.studentId.toString() : user._id.toString();
          const timestamp = Date.now();
          const videoFileName = `roleplay_video_${userId}_${sessionId}_${timestamp}.webm`;
          const storageFolder = 'roleplay_video_sessions';

          this.logger.info(`[uploadSessionVideo] Saving video for session ${sessionId}, filename: ${videoFileName}`);

          // Lưu video file stream trực tiếp vào storage bằng broker call đến files service
          const fileEntity = await this.broker.call('files.uploadRoleplayVideo', ctx.params, {
            meta: {
              ...ctx.meta,
              filename: videoFileName,
              mimetype: mimetype,
              $multipart: {
                fileType: 'video',
                folder: storageFolder,
                userId: userId,
                used: true,
              },
            },
          });

          if (!fileEntity || !fileEntity._id) {
            throw new MoleculerClientError('Failed to save video file.', 500);
          }

          // Cập nhật session với videoRecordingId và videoTurnMarkers
          const updateData = {
            videoRecordingId: fileEntity._id,
          };

          if (turnMarkers && Array.isArray(turnMarkers) && turnMarkers.length > 0) {
            updateData.videoTurnMarkers = turnMarkers;
          }

          await this.adapter.updateById(sessionId, {$set: updateData});

          this.logger.info(
            `[uploadSessionVideo] Video saved for session ${sessionId}, fileId: ${fileEntity._id}, size: ${fileEntity.size}`,
          );

          return {
            success: true,
            videoRecordingId: fileEntity._id,
            fileSize: fileEntity.size,
          };
        } catch (error) {
          this.logger.error('Error in uploadSessionVideo:', error);
          if (error instanceof MoleculerClientError) throw error;
          throw new MoleculerClientError('Error uploading session video.', 500);
        }
      },
    },

    bulkSoftDelete: {
      visibility: 'public',
      params: {
        ids: {type: 'array', items: 'string'},
      },
      async handler(ctx) {
        const {ids} = ctx.params;
        if (!ids || ids.length === 0) return {modifiedCount: 0};

        const now = new Date();
        const result = await this.adapter.updateMany(
          {_id: {$in: ids}, isDeleted: false},
          {$set: {isDeleted: true, deletedAt: now}},
        );
        const count = result.modifiedCount || result.nModified || 0;
        this.logger.info(`[bulkSoftDelete] Soft-deleted ${count} sessions`);
        return {modifiedCount: count};
      },
    },
  },

  events: {
    'roleplay.client.connected': {
      async handler(socket) {
        const connectionId = socket.id;
        this.logger.info(`RolePlay client connected: ${connectionId}`);

        const initialState = createConnectionState();
        initialState.socket = socket;
        initialState.voiceFlags = this.getVoiceFeatureFlags();
        connectionState.set(connectionId, initialState);

        socket.on('client:start_session', async data => {
          this.logger.info(`Nhận client:start_session từ ${connectionId}`, data);
          try {
            const result = await this.actions.startSession({
              sessionId: data.sessionId,
              userId: data.userId,
              studentId: data.studentId,
              courseId: data.courseId,
              aiPersonaId: data.aiPersonaId,
              socketId: connectionId,
            });
            const session = result.session;
            const state = connectionState.get(connectionId);

            state.sessionId = session._id.toString();
            state.userId = session.userId ? session.userId.toString() : null;
            state.personaId = session.personaId ? session.personaId.toString() : null;
            state.isSessionActive = true;
            state.courseId = session.courseId ? session.courseId.toString() : null;
            state.studentId = session.studentId ? session.studentId.toString() : null;
            state.clientSessionId = data.sessionId;
            this.logVoiceFlagDecisions(state);

            state.course = await this.broker.call('courses.get', {
              id: state.courseId,
            });

            // Lấy references từ scenario thay vì từ course
            if (state.scenario?.references?.length > 0) {
              const scenarioRefIds = state.scenario.references.map(r => (r._id || r).toString());
              const scenarioRefs = await this.broker.call('references.get', {
                id: scenarioRefIds,
              });
              state.course.references = Array.isArray(scenarioRefs) ? scenarioRefs : [scenarioRefs];
            } else {
              state.course.references = [];
            }
            if (state.scenario) {
              try {
                state.aiScenario = state.scenario;

                if (state.aiScenario && state.aiScenario.aiSpeaksFirst && state.aiScenario.initialAiMessage) {
                  state.conversationHistory = [
                    {
                      role: 'assistant',
                      content: state.aiScenario.initialAiMessage || 'Xin chào!',
                    },
                  ];
                } else {
                  state.conversationHistory = [];
                }
              } catch (error) {
                this.logger.warn(`Không thể lấy AI scenario ${state.aiScenarioId}:`, error.message);
                state.conversationHistory = [];
              }
            } else {
              state.conversationHistory = [];
            }
            state.persona = state.scenario?.aiPersonaId;

            if (!state.persona) {
              socket.emit('server:error', {message: 'Lỗi nghiêm trọng: Không thể xác định AI Persona từ khóa học.'});
              return;
            }

            // Fix P0: Đảm bảo llmModelId.apiKeyId được resolve thành object đầy đủ.
            // getDetailAIScenarioByCourse populate 'aiPersonaId.llmModelId.apiKeyId' nhưng
            // moleculer-db chỉ populate 1 level — apiKeyId có thể vẫn là ObjectId string.
            try {
              const llmModel = state.persona?.llmModelId;
              const apiKeyIdField = llmModel?.apiKeyId;
              const isApiKeyIdUnresolved =
                !apiKeyIdField ||
                typeof apiKeyIdField === 'string' ||
                (apiKeyIdField && !apiKeyIdField.apiKey && !apiKeyIdField.endpoint);

              if (isApiKeyIdUnresolved) {
                this.logger.warn(`[${state.sessionId}] persona.llmModelId.apiKeyId chưa được populate — đang re-fetch`);
                const personaId = state.persona?._id?.toString() || state.personaId;
                if (personaId) {
                  const freshPersona = await this.broker.call('aipersonas.get', {
                    id: personaId,
                    populate: ['llmModelId', 'voiceId', 'voiceId.apiKeyId'],
                  });
                  if (freshPersona) {
                    // Nếu llmModelId đã resolve thành object nhưng apiKeyId vẫn là ID → fetch riêng
                    const rawLlmModel = freshPersona.llmModelId;
                    if (rawLlmModel && typeof rawLlmModel !== 'string') {
                      const rawApiKeyId = rawLlmModel.apiKeyId;
                      if (rawApiKeyId && (typeof rawApiKeyId === 'string' || !rawApiKeyId.apiKey)) {
                        const apiKeyIdStr = typeof rawApiKeyId === 'string' ? rawApiKeyId : rawApiKeyId.toString();
                        const freshApiKey = await this.broker.call('apikeys.get', {id: apiKeyIdStr}).catch(() => null);
                        if (freshApiKey) {
                          rawLlmModel.apiKeyId = freshApiKey;
                        }
                      }
                    }
                    state.persona = freshPersona;
                    this.logger.info(`[${state.sessionId}] persona re-fetched, apiKey: ${state.persona?.llmModelId?.apiKeyId?.apiKey ? '***set***' : 'STILL_MISSING'}`);
                  }
                }
              }
            } catch (personaRefetchErr) {
              this.logger.error(`[${state.sessionId}] Lỗi khi re-fetch persona credentials:`, personaRefetchErr);
              // Không abort session — tiếp tục, lỗi sẽ bị phát hiện tại LLM provider
            }

            try {
              const globalSettings = await this.broker.call('settings.findOne');
              state.sttProvider = globalSettings?.sttProvider || 'azure';
            } catch (err) {
              this.logger.warn('Không thể tải global settings, sử dụng STT mặc định là azure');
              state.sttProvider = 'azure';
            }

            const messages = await this.generateConversationPrompt(state);
            if (state.conversationHistory.length === 0) {
              state.conversationHistory = messages;
            } else {
              const systemPrompts = messages.filter(m => m.role === 'system');
              const nonSystemHistory = state.conversationHistory.filter(m => m.role !== 'system');
              state.conversationHistory = [...systemPrompts, ...nonSystemHistory];
            }
            console.log('state.sttProvider', state.sttProvider);
            const sttV2Enabled = this.isVoiceFlagEnabled('VOICE_STT_V2_ENABLED', false, state);

            if (sttV2Enabled) {
              try {
                state.sttProviderInstance = createSTTProvider({
                  providerName: state.sttProvider,
                  broker: this.broker,
                  logger: this.logger,
                });

                state.sttProviderV2Handle = await state.sttProviderInstance.openStream({state});

                if (state.sttProviderV2Handle && typeof state.sttProviderV2Handle.setHints === 'function') {
                  await state.sttProviderV2Handle.setHints();
                }
              } catch (sttV2Err) {
                this.logger.error(`[${state.sessionId}] Lỗi khởi tạo STT v2 provider:`, sttV2Err);
              }
            } else {
              // Mở ElevenLabs hoặc ThinkLabs WS ngay khi start session
              if (state.sttProvider === 'elevenlabs' && !state.sttStreamId) {
                try {
                  const {streamId} = await this.broker.call('roleplay.elevenlabs.initializeSpeechStream', {
                    language: 'vi-VN',
                    sessionId: state.sessionId,
                  });
                  state.sttStreamId = streamId;
                  this.logger.info(`[${state.sessionId}] ElevenLabs WS opened: ${streamId}`);
                } catch (wsErr) {
                  this.logger.error(`[${state.sessionId}] Lỗi mở ElevenLabs stream:`, wsErr);
                }
              } else if (state.sttProvider === 'thinklabs' && !state.sttStreamId) {
                try {
                  const {streamId} = await this.broker.call('roleplay.thinklabs.initializeSpeechStream', {
                    language: 'vi-VN',
                    sessionId: state.sessionId,
                  });
                  state.sttStreamId = streamId;
                  this.logger.info(`[${state.sessionId}] ThinkLabs WS opened: ${streamId}`);
                } catch (wsErr) {
                  this.logger.error(`[${state.sessionId}] Lỗi mở ThinkLabs stream:`, wsErr);
                }
              }

              // Gửi normalization hints cho STT provider (nếu provider hỗ trợ)
              // Phải gửi SAU khi WS mở và TRƯỚC khi client bắt đầu gửi audio
              if (state.sttStreamId) {
                try {
                  const provider = this._getSTTProvider(state);
                  await provider.sendHints(this.broker, state, this.logger);
                } catch (hintsErr) {
                  this.logger.error(`[${state.sessionId}] Lỗi gửi normalization hints:`, hintsErr);
                }
              }
            }

            // Emit session_started NGAY LẬP TỨC để client render UI, không phải chờ TTS
            socket.emit('server:session_started', session);

            // Xử lý TTS/LLM cho câu đầu tiên BẤT ĐỒNG BỘ (fire-and-forget)
            const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];
            if (
              lastMessage &&
              lastMessage.role === 'assistant' &&
              lastMessage.content &&
              lastMessage.content.trim() !== ''
            ) {
              // AI nói trước: xử lý TTS bất đồng bộ
              (async () => {
                this.logger.info(
                  `[${state.sessionId}] Last message in initial history is from assistant, processing TTS for: "${lastMessage.content}"`,
                );
                socket.emit('server:ai_tts_started', {sessionId: state.sessionId});
                try {
                  const audioBuffer = await this.processSingleSentenceToSpeech(state, lastMessage.content, socket);
                  if (audioBuffer) {
                    this.logger.info(`[${state.sessionId}] Successfully processed TTS for initial assistant message.`);
                  } else {
                    this.logger.warn(
                      `[${state.sessionId}] TTS processing for initial assistant message returned no audio buffer.`,
                    );
                  }
                } catch (ttsError) {
                  this.logger.error(
                    `[${state.sessionId}] Error processing TTS for initial assistant message:`,
                    ttsError,
                  );
                  socket.emit('server:error', {
                    sessionId: state.sessionId,
                    message: 'Lỗi khi tạo lời nói cho tin nhắn đầu tiên của trợ lý.',
                  });
                } finally {
                  socket.emit('server:ai_tts_completed', {sessionId: state.sessionId});
                }
              })().catch(err => {
                this.logger.error(`[${state.sessionId}] Unhandled error in async initial TTS:`, err);
              });
            } else if (
              lastMessage &&
              lastMessage.role === 'user' &&
              lastMessage.content &&
              lastMessage.content.trim() !== ''
            ) {
              // User nói trước: xử lý LLM bất đồng bộ
              if (state.socket) {
                this.triggerOrchestratorRun(state, {
                  source: 'initial_user_message',
                }).catch(err => {
                  this.logger.error(`[${state.sessionId}] Error in async initial LLM response:`, err);
                });
              } else {
                socket.emit('server:error', {
                  sessionId: state.sessionId,
                  message: 'Lỗi máy chủ: Không thể xử lý tin nhắn đầu tiên của bạn do thiếu thông tin kết nối.',
                });
              }
            }
          } catch (err) {
            this.logger.error('Lỗi khi bắt đầu phiên roleplay:', err);
            socket.emit('server:error', {message: 'Không thể bắt đầu phiên roleplay'});
          }
        });

        socket.on('client:student_speech_chunk', async data => {
          try {
            const state = connectionState.get(connectionId);
            if (!state || !state.isSessionActive) {
              this.logger.warn(
                'client:student_speech_chunk: Nhận được chunk khi session không active hoặc không có state',
              );
              return;
            }
            if (this.isGeminiLiveVoiceChatEnabled(state)) {
              await this._handleStudentAudioChunkGeminiLive(state, data.audioChunk, data.format, socket);
            } else {
              await this._handleStudentAudioChunk(state, data.audioChunk, data.format, socket);
            }
          } catch (err) {
            this.logger.error('Lỗi khi xử lý client:student_speech_chunk event:', err);
          }
        });

        socket.on('client:end_session', async data => {
          console.log('data', data);
          this.logger.info(`Nhận client:end_session từ ${connectionId}`, data); // data chứa sessionId (client UUID) và reason
          try {
            const state = connectionState.get(connectionId);
            if (!state || !state.sessionId) {
              this.logger.warn(
                'client:end_session: Không tìm thấy state hoặc sessionId cho connectionId:',
                connectionId,
              );
              socket.emit('server:error', {message: 'Không thể kết thúc phiên, thông tin phiên không hợp lệ.'});
              return;
            }

            state.isProcessingSpeech = false;
            this.logInterruptSummary(state);

            await this.requestOrchestratorCancel(state, 'end_session').catch(cancelErr => {
              this.logger.error(`Lỗi cancel orchestrator khi end_session:`, cancelErr);
            });

            if (this.isVoiceFlagEnabled('VOICE_VAD_SERVICE_ENABLED', false, state) && state.sessionId) {
              try {
                await this.broker.call('roleplay.vad.cleanup', {sessionId: state.sessionId});
              } catch (vadCleanupErr) {
                this.logger.error(`Lỗi cleanup VAD service khi end_session:`, vadCleanupErr);
              }
            }

            if (this.isGeminiLiveVoiceChatEnabled(state)) {
              this.closeGeminiLiveSession(state);
            }

            // Đóng STT stream khi kết thúc session
            const sttV2Enabled = this.isVoiceFlagEnabled('VOICE_STT_V2_ENABLED', false, state);
            if (sttV2Enabled) {
              try {
                if (state.sttProviderV2Handle && typeof state.sttProviderV2Handle.closeSession === 'function') {
                  await state.sttProviderV2Handle.closeSession();
                } else if (
                  state.sttProviderInstance &&
                  typeof state.sttProviderInstance.closeSessionStream === 'function'
                ) {
                  await state.sttProviderInstance.closeSessionStream({state});
                }
              } catch (sttCloseErr) {
                this.logger.error(`Lỗi đóng STT v2 stream khi end_session:`, sttCloseErr);
              } finally {
                state.sttProviderV2Handle = null;
                state.sttProviderInstance = null;
              }
            } else if (state.sttStreamId) {
              if (state.sttProvider === 'elevenlabs') {
                try {
                  await this.broker.call('roleplay.elevenlabs.closeStream', {streamId: state.sttStreamId});
                  state.sttStreamId = null;
                } catch (wsErr) {
                  this.logger.error(`Lỗi đóng ElevenLabs stream khi end_session:`, wsErr);
                }
              } else if (state.sttProvider === 'thinklabs') {
                try {
                  await this.broker.call('roleplay.thinklabs.closeStream', {streamId: state.sttStreamId});
                  state.sttStreamId = null;
                } catch (wsErr) {
                  this.logger.error(`Lỗi đóng ThinkLabs stream khi end_session:`, wsErr);
                }
              }
            }

            const result = await this.actions.endSession({
              sessionId: state.sessionId, // Sử dụng DB sessionId từ state
              socketId: connectionId,
              reason: data.reason,
            });

            socket.emit('server:session_ended', result);
          } catch (err) {
            this.logger.error('Lỗi khi xử lý client:end_session event:', err);
            socket.emit('server:error', {message: 'Lỗi khi kết thúc phiên roleplay'});
          }
        });

        socket.on('disconnect', async reason => {
          this.logger.info(`RolePlay client ngắt kết nối: ${connectionId}. Lý do: ${reason}`);

          const state = connectionState.get(connectionId);
          if (state && state.sessionId) {
            // sessionId là _id của DB
            try {
              state.isProcessingSpeech = false;
              this.logInterruptSummary(state);

              await this.requestOrchestratorCancel(state, 'disconnect').catch(cancelErr => {
                this.logger.error(`Lỗi cancel orchestrator khi disconnect:`, cancelErr);
              });

              if (this.isVoiceFlagEnabled('VOICE_VAD_SERVICE_ENABLED', false, state) && state.sessionId) {
                try {
                  await this.broker.call('roleplay.vad.cleanup', {sessionId: state.sessionId});
                } catch (vadCleanupErr) {
                  this.logger.error(`Lỗi cleanup VAD service khi disconnect:`, vadCleanupErr);
                }
              }

              if (this.isGeminiLiveVoiceChatEnabled(state)) {
                this.closeGeminiLiveSession(state);
              }

              // Đóng STT stream khi disconnect
              const sttV2Enabled = this.isVoiceFlagEnabled('VOICE_STT_V2_ENABLED', false, state);
              if (sttV2Enabled) {
                try {
                  if (state.sttProviderV2Handle && typeof state.sttProviderV2Handle.closeSession === 'function') {
                    await state.sttProviderV2Handle.closeSession();
                  } else if (
                    state.sttProviderInstance &&
                    typeof state.sttProviderInstance.closeSessionStream === 'function'
                  ) {
                    await state.sttProviderInstance.closeSessionStream({state});
                  }
                } catch (sttCloseErr) {
                  this.logger.error(`Lỗi đóng STT v2 stream khi disconnect:`, sttCloseErr);
                } finally {
                  state.sttProviderV2Handle = null;
                  state.sttProviderInstance = null;
                }
              } else if (state.sttStreamId) {
                if (state.sttProvider === 'elevenlabs') {
                  try {
                    await this.broker.call('roleplay.elevenlabs.closeStream', {streamId: state.sttStreamId});
                    state.sttStreamId = null;
                  } catch (wsErr) {
                    this.logger.error(`Lỗi đóng ElevenLabs stream khi disconnect:`, wsErr);
                  }
                } else if (state.sttProvider === 'thinklabs') {
                  try {
                    await this.broker.call('roleplay.thinklabs.closeStream', {streamId: state.sttStreamId});
                    state.sttStreamId = null;
                  } catch (wsErr) {
                    this.logger.error(`Lỗi đóng ThinkLabs stream khi disconnect:`, wsErr);
                  }
                }
              }

              await this.actions.handleDisconnectedSession({
                sessionId: state.sessionId,
                socketId: connectionId,
                state: state, // Truyền toàn bộ state
              });
            } catch (err) {
              this.logger.error('Lỗi khi gọi handleDisconnectedSession:', err);
            }
          } else if (state) {
            this.logger.info(`Client ${connectionId} ngắt kết nối nhưng không có DB sessionId trong state.`);
          } else {
            this.logger.info(`Client ${connectionId} ngắt kết nối nhưng không tìm thấy connectionState.`);
          }

          // connectionState.delete(connectionId);
          this.logger.info(`Đã xóa connectionState cho ${connectionId}`);
        });

        // Thông báo cho client rằng server đã sẵn sàng
        socket.emit('server:ready', {status: 'ready'});
      },
    },

    // Event handlers cho STT streaming từ speechprocessing.service
    'speech.stream.recognizing': {
      group: 'local', // Chỉ xử lý trên node đã gọi speechprocessing
      async handler(payload) {
        const {streamId, sessionId: eventSessionId, text} = payload;
        // console.log(`Nhận recognizing: streamId=${streamId}, text="${text}"`, new Date());

        const state = this.findStateBySttStreamIdOrSessionIdOnly(streamId, eventSessionId);

        if (state && state.isSessionActive && state.socket) {
          let incorrectTexts = ['Phẩy.'];
          if (text && text.trim() !== '' && !incorrectTexts.includes(text.trim())) {
            state.sttResult = text;
            state.socket.emit('server:student_text_response', {
              sessionId: state.sessionId,
              text: text, // Gửi phần text mới nhất
              role: 'user',
              isFinal: false,
            });
          } else {
            this.logger.info(
              `speech.stream.recognized: Text rỗng hoặc chỉ chứa khoảng trắng, bỏ qua xử lý LLM. StreamId: ${streamId}`,
            );
          }
        } else {
          this.logger.warn(
            `Không tìm thấy state hoặc socket hợp lệ cho speech.stream.recognizing, streamId: ${streamId}, eventSessionId: ${eventSessionId}`,
          );
        }
      },
    },

    'speech.stream.recognized': {
      group: 'local',
      async handler(payload) {
        const {streamId, sessionId: eventSessionId, text, duration, offset, isFinal} = payload;
        console.log(
          `Nhận recognized: streamId=${streamId}, text="${text}", duration=${duration}, isFinal=${isFinal}`,
          new Date(),
        );

        const state = this.findStateBySttStreamIdOrSessionIdOnly(streamId, eventSessionId);

        if (state && state.isSessionActive) {
          let incorrectTexts = ['Phẩy.'];

          if (text && text.trim() !== '' && !incorrectTexts.includes(text.trim())) {
            // ThinkLabs: text đã là delta (phần mới), nhưng đã được chuẩn hoá hoàn chỉnh cho turn này
            // → Ghi đè transcript thay vì nối thêm, vì text_update tích luỹ đã được diff ở service
            if (state.sttProvider === 'thinklabs') {
              state.currentStudentTranscript = text;
            } else {
              state.currentStudentTranscript += text + ' ';
            }
          } else {
            this.logger.info(
              `speech.stream.recognized: Text rỗng hoặc chỉ chứa khoảng trắng, bỏ qua xử lý LLM. StreamId: ${streamId}`,
            );
          }

          if (isFinal) {
            const sttLatency = this.endVoicePhaseTimer(state, 'stt.final');
            if (typeof sttLatency === 'number') {
              this.recordVoiceBaselineMetric('stt.final.latency', sttLatency, state.sessionId, state.currentTurnId);
            }
            this.logger.info(`Đã nhận final transcript, gọi finalizeStudentTurn cho session ${state.sessionId}`);
            await this.finalizeStudentTurn(state);
          }
        } else {
          this.logger.warn(
            `Không tìm thấy state hoặc socket hợp lệ cho speech.stream.recognized, streamId: ${streamId}, eventSessionId: ${eventSessionId}`,
          );
        }
      },
    },

    'speech.stream.nomatch': {
      group: 'local',
      async handler(payload) {
        const {streamId, sessionId: eventSessionId, reason} = payload;
        this.logger.warn(`Nhận speech.stream.nomatch: streamId=${streamId}, reason="${reason}"`);
        const state = this.findStateBySttStreamIdOrSessionIdOnly(streamId, eventSessionId);

        if (state && state.isSessionActive) {
          if (state.socket) {
            state.socket.emit('server:stt_nomatch', {
              sessionId: state.sessionId,
              message: 'Không nhận dạng được giọng nói.',
            });
          }
        }
      },
    },

    'speech.stream.error': {
      group: 'local',
      async handler(payload) {
        const {streamId, sessionId: eventSessionId, errorCode, errorDetails} = payload;
        this.logger.error(
          `Nhận speech.stream.error: streamId=${streamId}, code=${errorCode}, details="${errorDetails}"`,
        );
        const state = this.findStateBySttStreamIdOrSessionIdOnly(streamId, eventSessionId);

        if (state && state.isSessionActive) {
          if (state.socket) {
            state.socket.emit('server:error', {
              sessionId: state.sessionId,
              message: `Lỗi STT streaming: ${errorDetails}`,
            });
          }
          if (state.sttStreamId === streamId) {
            try {
              await this.broker.call('roleplay.speechprocessing.closeSpeechStream', {streamId: state.sttStreamId});
              // await this.broker.call('roleplay.elevenlabs.closeSpeechStream', { streamId: state.sttStreamId });
            } catch (closeError) {
              this.logger.error(
                `Lỗi khi cố gắng đóng speech stream ${state.sttStreamId} sau khi nhận lỗi từ stream:`,
                closeError,
              );
            }
            state.sttStreamId = null;
            state.isStudentSpeaking = false;
            this.endVoicePhaseTimer(state, 'stt.final');
          }
        }
      },
    },

    'roleplay.analysis.completed': {
      group: 'local', // Hoặc tên group phù hợp
      async handler(payload) {
        const {sessionId, analysisId} = payload;
        this.logger.info(
          `Nhận sự kiện 'roleplay.analysis.completed' cho sessionId: ${sessionId} với analysisId: ${analysisId}`,
        );
        try {
          const session = await this.adapter.findById(sessionId);
          if (session) {
            await this.adapter.updateById(sessionId, {
              $set: {
                analysisId: analysisId,
                status: 'analyzed', // Cập nhật trạng thái session là đã phân tích
              },
            });
            this.logger.info(`Đã cập nhật analysisId ${analysisId} và status 'analyzed' cho session ${sessionId}.`);
          } else {
            this.logger.warn(`Không tìm thấy session ${sessionId} để cập nhật analysisId.`);
          }
        } catch (error) {
          this.logger.error(`Lỗi khi xử lý sự kiện 'roleplay.analysis.completed' cho session ${sessionId}:`, error);
        }
      },
    },
  },

  methods: {
    getVoiceFeatureFlags() {
      return {
        VOICE_TTS_V2_ENABLED: isFlagEnabled('VOICE_TTS_V2_ENABLED', true),
        VOICE_STT_V2_ENABLED: isFlagEnabled('VOICE_STT_V2_ENABLED', true),
        VOICE_VAD_SERVICE_ENABLED: isFlagEnabled('VOICE_VAD_SERVICE_ENABLED', true),
        VOICE_ORCHESTRATOR_V2_ENABLED: isFlagEnabled('VOICE_ORCHESTRATOR_V2_ENABLED', true),
        VOICE_LLM_V2_ENABLED: isFlagEnabled('VOICE_LLM_V2_ENABLED', true),
        VOICE_GATEWAY_V2_ENABLED: isFlagEnabled('VOICE_GATEWAY_V2_ENABLED', false),
      };
    },

    isVoiceFlagEnabled(flagName, defaultValue = false, state = null) {
      if (state && state.voiceFlags && typeof state.voiceFlags[flagName] === 'boolean') {
        return state.voiceFlags[flagName];
      }
      return isFlagEnabled(flagName, defaultValue);
    },

    findStateBySessionId(sessionId) {
      if (!sessionId) return null;
      for (const state of connectionState.values()) {
        if (state.sessionId === sessionId) {
          return state;
        }
      }
      return null;
    },

    async triggerOrchestratorRun(state, payload = {}) {
      if (!state || !state.sessionId || !state.isSessionActive) {
        return {success: false, skipped: true, reason: 'invalid_state'};
      }

      const source = payload.source || 'runtime';
      const transcript = payload.transcript || '';

      if (this.isVoiceFlagEnabled('VOICE_ORCHESTRATOR_V2_ENABLED', true, state)) {
        return this.broker.call('roleplay.orchestrator.run', {
          sessionId: state.sessionId,
          transcript,
          source,
          turnId: state.currentTurnId || null,
        });
      }

      await this.processLLMAndResponse(state, state.socket, {
        source,
      });
      return {success: true, fallback: true};
    },

    async requestOrchestratorCancel(state, reason = 'interrupt') {
      if (!state || !state.sessionId) {
        return {cancelled: false, reason: 'invalid_state'};
      }

      if (this.isVoiceFlagEnabled('VOICE_ORCHESTRATOR_V2_ENABLED', true, state)) {
        return this.broker.call('roleplay.orchestrator.cancel', {
          sessionId: state.sessionId,
          reason,
        });
      }

      state.isAiInterruptedByStudent = true;
      if (state.isAiResponding) {
        this.markInterruptAttempt(state);
        this.markInterruptSuccess(state);
      }

      return {cancelled: !!state.isAiResponding, fallback: true, reason};
    },

    logVoiceFlagDecisions(state) {
      if (!state || !state.sessionId) return;
      const flags = state.voiceFlags || this.getVoiceFeatureFlags();
      Object.entries(flags).forEach(([flagName, flagValue]) => {
        logFlagDecision(this.logger, {
          flagName,
          flagValue,
          sessionId: state.sessionId,
          turnId: state.currentTurnId || 'session-init',
        });
      });
    },

    nextTurnId(state) {
      if (!state) return `turn_${Date.now()}`;
      state.turnCounter = (state.turnCounter || 0) + 1;
      const turnId = `turn_${state.sessionId || 'unknown'}_${state.turnCounter}`;
      state.currentTurnId = turnId;
      return turnId;
    },

    startVoicePhaseTimer(state, phase, turnId = null) {
      if (!state) return null;
      const effectiveTurnId = turnId || state.currentTurnId || 'na';
      return startVoiceTimer({
        state,
        phase,
        sessionId: state.sessionId,
        turnId: effectiveTurnId,
      });
    },

    endVoicePhaseTimer(state, phase, turnId = null) {
      if (!state) return null;
      const effectiveTurnId = turnId || state.currentTurnId || 'na';
      return endVoiceTimer({
        state,
        phase,
        sessionId: state.sessionId,
        turnId: effectiveTurnId,
      });
    },

    recordVoiceBaselineMetric(metricName, value, sessionId, turnId, extra = {}) {
      recordVoiceMetric(this.logger, {
        metricName,
        value,
        sessionId,
        turnId,
        unit: 'ms',
        extra,
      });
    },

    markInterruptAttempt(state) {
      markInterruptAttemptMetric(state);
    },

    markInterruptSuccess(state) {
      markInterruptSuccessMetric(state);
    },

    logInterruptSummary(state) {
      if (!state || !state.sessionId) return;
      const stats = getInterruptStats(state);
      recordVoiceMetric(this.logger, {
        metricName: 'interrupt.success_rate',
        value: stats.successRate,
        sessionId: state.sessionId,
        turnId: state.currentTurnId || 'session-summary',
        unit: 'ratio',
        extra: {
          attempted: stats.attempted,
          succeeded: stats.succeeded,
        },
      });
    },

    // Đổi tên helper method và chỉ trả về state
    findStateBySttStreamIdOrSessionIdOnly(sttStreamId, sessionId) {
      if (sttStreamId) {
        for (const state of connectionState.values()) {
          // Duyệt qua values thay vì entries
          if (state.sttStreamId === sttStreamId) {
            return state;
          }
        }
      }
      if (sessionId) {
        for (const state of connectionState.values()) {
          // Duyệt qua values
          if (state.sessionId === sessionId && state.isSessionActive) {
            if (sttStreamId && state.sttStreamId && state.sttStreamId !== sttStreamId) {
              continue;
            }
            this.logger.debug(
              `Tìm thấy state bằng sessionId ${sessionId} khi sttStreamId ${sttStreamId} không khớp hoặc không có.`,
            );
            return state;
          }
        }
      }
      this.logger.warn(`Không tìm thấy state cho sttStreamId: ${sttStreamId} hoặc sessionId: ${sessionId}`);
      return null; // Trả về null nếu không tìm thấy
    },

    async generateConversationPrompt(state) {
      if (!state.courseId || !state.personaId) {
        this.logger.error('generateConversationPrompt: Thiếu courseId hoặc personaId trong state', state);
        return [{role: 'system', content: 'Lỗi: Không thể tải thông tin khóa học hoặc persona.'}];
      }
      const {course, persona, aiScenario} = state;
      if (!course || !persona) {
        this.logger.error(`Không tìm thấy Course (ID: ${state.courseId}) hoặc Persona (ID: ${state.personaId})`);
        return [{role: 'system', content: 'Lỗi: Không thể tải thông tin khóa học hoặc persona.'}];
      }

      try {
        const nonSystemHistory = state.conversationHistory.filter(m => m.role !== 'system');

        const enrichedCourse = {
          ...course,
          roleplayInstructionId: persona?.roleplayInstructionId || course.roleplayInstructionId,
        };

        const messages = await this.broker.call('roleplay.openai.createPersonaPrompt', {
          persona: persona,
          course: enrichedCourse,
          conversation: nonSystemHistory,
          scenario: state.scenario,
        });

        if (course.introduction) {
          const systemIndex = messages.findIndex(m => m.role === 'system');
          if (systemIndex !== -1) {
            messages.splice(systemIndex + 1, 0, {role: 'assistant', content: course.introduction});
          } else {
            messages.unshift({role: 'assistant', content: course.introduction});
          }
        }
        return messages;
      } catch (error) {
        this.logger.error(`Lỗi khi gọi createPersonaPrompt: ${error.message}`, error);
        return [{role: 'system', content: 'Lỗi: Không thể tạo prompt cho AI Persona.'}];
      }
    },
  },

  created() {},

  async started() {
    this.createFolderIfNotExist(storageDir);
  },

  async stopped() {},
};
