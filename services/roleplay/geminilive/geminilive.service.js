let GoogleGenAI;
let Modality;

const actorAgentTools = [
  {
    functionDeclarations: [
      {
        name: 'end_conversation',
        description:
          'Kết thúc cuộc hội thoại khi đạt được mục tiêu, câu chuyện kết thúc tự nhiên, hoặc khi cảm thấy cuộc gọi nên dừng lại. Sử dụng khi: khách hàng đã đồng ý/từ chối rõ ràng, cuộc trò chuyện đã hoàn tất mục đích, hoặc không còn gì để thảo luận.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Lý do kết thúc cuộc gọi',
              enum: ['goal_achieved', 'customer_declined', 'conversation_complete', 'customer_busy', 'natural_ending'],
            },
            summary: {
              type: 'string',
              description: 'Tóm tắt ngắn gọn kết quả cuộc hội thoại',
            },
          },
          required: ['reason', 'summary'],
        },
      },
      {
        name: 'get_scenario_reference',
        description:
          'Lấy nội dung tài liệu tham khảo (kịch bản mẫu, hướng dẫn, thông tin sản phẩm) để hỗ trợ cuộc hội thoại. Sử dụng khi cần tham khảo thông tin cụ thể về sản phẩm, dịch vụ hoặc quy trình.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Từ khóa hoặc câu hỏi để tìm kiếm tài liệu tham khảo phù hợp',
            },
          },
          required: ['query'],
        },
      },
    ],
  },
];

module.exports = {
  name: 'roleplay.geminilive',

  dependencies: ['socket', 'references'],

  settings: {},

  actions: {},

  methods: {
    async handleStartSession(socket, data) {
      const {sessionId, personaId, scenarioId, userId, courseId} = data;

      this.logger.info(`[${sessionId}] Starting GeminiLive session`);

      try {
        if (this.sessions.has(sessionId)) {
          this.logger.warn(`[${sessionId}] Session already exists`);
          socket.emit('server:error', {
            sessionId,
            error: 'Session already exists',
            code: 'SESSION_EXISTS',
          });
          return;
        }
        const persona = await this.broker.call('aipersonas.get', {
          id: personaId,
          populate: ['voiceId.apiKeyId', 'llmModelId', 'roleplayInstructionId'],
        });
        const scenario = await this.broker.call('aiscenarios.get', {
          id: scenarioId,
          populate: ['references'],
        });

        let scenarioSkills = [];
        let scenarioSkillIds = [];
        try {
          scenarioSkills = await this.broker.call('scenarioskills.getSkillsByScenario', {
            scenarioId: scenarioId.toString(),
          });
          scenarioSkillIds = scenarioSkills.map(ss => ss._id.toString());
          this.logger.info(`[${sessionId}] Loaded ${scenarioSkills.length} skills from scenario`);
        } catch (skillErr) {
          this.logger.error(`[${sessionId}] Error loading scenario skills:`, skillErr);
        }

        let courseData = null;
        if (courseId) {
          try {
            courseData = await this.broker.call('courses.get', {id: courseId});
            if (courseData) {
              // Kiểm tra khóa học có đang hoạt động không
              if (courseData.isDeleted) {
                socket.emit('server:error', {sessionId, error: 'Khóa học không tồn tại.', code: 'COURSE_NOT_FOUND'});
                return;
              }
              if (!courseData.isActive) {
                socket.emit('server:error', {sessionId, error: 'Khóa học hiện không hoạt động.', code: 'COURSE_INACTIVE'});
                return;
              }
              // Kiểm tra user có quyền truy cập khóa học không
              if (courseData.publishedToUsers) {
                const hasAccess = courseData.publishedToUsers.some(entry => {
                  const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
                  return uid === userId;
                });
                if (!hasAccess) {
                  socket.emit('server:error', {sessionId, error: 'Bạn không có quyền truy cập khóa học này.', code: 'ACCESS_DENIED'});
                  return;
                }
              }
            }
          } catch (courseErr) {
            this.logger.warn(`[${sessionId}] Could not load course ${courseId}:`, courseErr.message);
          }
        }

        const sessionEntity = {
          clientSessionId: sessionId,
          userId: userId,
          personaId: personaId,
          socketId: socket.id,
          startedAt: new Date(),
          isActive: true,
          status: 'in_progress',
          studentId: userId,
          createdBy: userId,
          courseId: courseId,
          aiScenarioId: scenarioId,
          scenarioSkillIds: scenarioSkillIds,
        };

        const dbSession = await this.broker.call('roleplaysessions.insert', {
          entity: sessionEntity,
        });

        this.logger.info(`[${sessionId}] DB session created: ${dbSession._id}`);

        const sessionData = {
          socket,
          socketId: socket.id,
          geminiSession: null,
          geminiConnected: false,
          userId,
          studentId: userId,
          createdBy: userId,
          personaId,
          scenarioId,
          courseId: courseId,
          courseData,
          scenarioSkills,
          scenarioSkillIds,
          dbSessionId: dbSession._id.toString(),
          userAudioBuffers: [],
          aiAudioBuffers: [],
          currentUserTurnAudioChunks: [],
          currentAiTurnAudioChunks: [],
          userTranscript: '',
          aiTranscript: '',
          conversationHistory: [],
          turnCount: 0,
          lastTurnAt: null,
          startedAt: new Date(),
        };

        this.sessions.set(sessionId, sessionData);

        await this.createGeminiLiveSession(sessionId, courseData, persona, scenario);
      } catch (error) {
        this.logger.error(`[${sessionId}] Error starting session:`, error);
        socket.emit('server:error', {
          sessionId,
          error: 'Failed to start session',
          code: 'START_SESSION_ERROR',
          details: error.message,
        });

        // Cleanup
        this.sessions.delete(sessionId);
      }
    },

    async handleAudioChunk(socket, data) {
      const {sessionId, audioChunk} = data;

      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) {
        this.logger.warn(`[${sessionId}] Session not found for audio`);
        return;
      }

      if (!sessionData.geminiSession || !sessionData.geminiConnected) {
        this.logger.warn(`[${sessionId}] GeminiLive not connected, dropping audio`);
        return;
      }

      await this.sendAudioToGemini(sessionId, audioChunk);
    },

    async handleStopSession(socket, data) {
      const {sessionId} = data;
      this.logger.info(`[${sessionId}] Stopping session`);

      try {
        const result = await this.closeAndSaveSession(sessionId);
        if (socket && result?.success) {
          socket.emit('server:session_ended', result);
        }
      } catch (error) {
        this.logger.error(`[${sessionId}] Error in handleStopSession:`, error);
        if (socket) {
          socket.emit('server:error', {
            sessionId,
            error: 'Failed to save session data',
            code: 'SAVE_ERROR',
            details: error.message,
          });
        }
      }
    },

    async handleEndSession(socket, data) {
      const {sessionId} = data;
      this.logger.info(`[${sessionId}] Ending session from client:end_session`);

      try {
        const sessionData = this.sessions.get(sessionId);
        if (!sessionData) {
          this.logger.warn(`[${sessionId}] Session not found for ending`);
          socket.emit('server:error', {message: 'Không thể kết thúc phiên, thông tin phiên không hợp lệ.'});
          return;
        }

        const result = await this.closeAndSaveSession(sessionId);

        if (result?.success) {
          socket.emit('server:session_ended', result);
        } else {
          socket.emit('server:error', {message: 'Lỗi khi kết thúc phiên roleplay'});
        }
      } catch (error) {
        this.logger.error(`[${sessionId}] Error in handleEndSession:`, error);
        socket.emit('server:error', {message: 'Lỗi khi kết thúc phiên roleplay'});
      }
    },

    async createGeminiLiveSession(sessionId, course, persona, scenario) {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) {
        throw new Error('Session data not found');
      }
      const geminiVoice = persona.voiceId.configName || 'Puck';
      const apiKey = persona.voiceId.apiKeyId.apiKey || 'AIzaSyBWlK4VaEKfn-oS5YMU5SJYXHQB6VYyg8A';
      const systemInstruction = this.buildSystemInstruction(course, persona, scenario);
      console.log('systemInstruction', systemInstruction);
      if (!apiKey) {
        throw new Error('Missing Google API Key for GeminiLive');
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {apiVersion: 'v1alpha'},
      });
      const geminiSession = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: geminiVoice}},
          },
          systemInstruction: {
            parts: [{text: systemInstruction}],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: actorAgentTools,
        },
        callbacks: {
          onopen: () => {
            this.logger.info(`[${sessionId}] GeminiLive connected`);
            sessionData.geminiConnected = true;
            sessionData.socket.emit('server:session_started', {
              sessionId,
              dbSessionId: sessionData.dbSessionId,
              status: 'ready',
            });
          },
          onmessage: msg => {
            if (!sessionData.geminiSession.started && scenario.aiSpeaksFirst) {
              console.log('scenario', scenario);
              sessionData.geminiSession.started = true;
              sessionData.geminiSession.sendRealtimeInput({
                text: 'Conversation started.',
              });
            }
            this.handleGeminiResponse(sessionId, msg);
          },
          onerror: err => {
            this.logger.error(`[${sessionId}] GeminiLive error:`, err);
            sessionData.socket.emit('server:error', {
              sessionId,
              error: 'GeminiLive connection error',
              code: 'GEMINI_ERROR',
              details: err.message,
            });
          },
          onclose: e => {
            this.logger.info(`[${sessionId}] GeminiLive closed:`, e?.reason || 'unknown');
            sessionData.geminiConnected = false;
          },
        },
      });

      sessionData.geminiSession = geminiSession;
      this.logger.info(`[${sessionId}] GeminiLive session created`);
    },

    buildSystemInstruction: function (course, persona, scenario) {
      let instruction = persona.roleplayInstructionId?.conversationInstruction || '';
      if (persona.personaPrompt) {
        instruction = `NHÂN VẬT: ${ persona.personaPrompt }`;
        if (persona.filterWords?.length > 0) {
          instruction = instruction + `\nTỪ NÊN TRÁNH: ${persona.filterWords.join(', ')}`;
        }
      } else {
        const personaInfo = `- Họ và tên: ${persona.name}
        - Vai trò: ${persona.role || 'Khách hàng'}
        - Giới tính: ${persona.gender === 'female' ? 'Nữ' : 'Nam'}
        - Tuổi: ${persona.age || 30}
        - Đơn vị: ${persona.organization || 'Chưa xác định'}
        - Mối quan tâm: ${persona.personaConcern || 'Chưa xác định'}
        - Background: ${persona.personaBackground || 'Chưa xác định'}
        - Tâm trạng: ${persona.mood || 'Bình thường'}
        - Khả năng nói chuyện phiếm: ${persona.smallTalkLikely || 50}%
        ${persona.filterWords?.length > 0 ? `- Từ nên TRÁNH: ${persona.filterWords.join(', ')}` : ''}`;

        const courseInfo = `- Khóa học: ${course?.name || 'Đào tạo'}
        - Mô tả: ${course?.description || ''}`;

        instruction = instruction.replace('{personaInfo}', personaInfo);
        instruction = instruction.replace('{courseInfo}', courseInfo);
      }

      if (scenario.aiSpeaksFirst && scenario.initialAiMessage) {
        instruction += `\n\nIMPORTANT: You MUST start the conversation by saying: "${scenario.initialAiMessage}" and you MUST return an audio response. Not say anything else and keep the conversation going next turn.`;
      }

      if (persona.conversationEndCondition) {
        instruction += `\n\n[ĐIỀU KIỆN KẾT THÚC CUỘC TRÒ CHUYỆN]\n${persona.conversationEndCondition}`;
      }

      const suffix = `
        LANGUAGE RULES:
        - Người dùng CHỈ nói tiếng Việt hoặc tiếng Anh. Nếu không rõ, giả định là tiếng Việt.
        - CHỈ TRẢ LỜI bằng tiếng Việt hoặc tiếng Anh tùy ngôn ngữ người dùng.

        TOOLS:
        - end_conversation: Kết thúc khi mục tiêu đạt được, khách đồng ý/từ chối rõ ràng, hoặc kết thúc tự nhiên.
        - get_scenario_reference: Tra cứu khi cần thông tin sản phẩm/dịch vụ/quy trình cụ thể.`;

      return instruction.trim() + '\n\n' + suffix;
    },

    async sendAudioToGemini(sessionId, audioChunk) {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.geminiSession) {
        return;
      }

      const bufferChunk = Buffer.isBuffer(audioChunk) ? audioChunk : Buffer.from(audioChunk);

      sessionData.currentUserTurnAudioChunks.push(bufferChunk);

      try {
        sessionData.geminiSession.sendRealtimeInput({
          audio: {
            data: bufferChunk.toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch (error) {
        this.logger.error(`[${sessionId}] Error sending audio to GeminiLive:`, error);
      }
    },

    async handleGeminiResponse(sessionId, msg) {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.socket) return;

      const socket = sessionData.socket;

      if (msg.serverContent?.inputTranscription?.text) {
        const userText = msg.serverContent.inputTranscription.text;
        sessionData.userTranscript += userText;

        socket.emit('server:user_transcript', {
          sessionId,
          text: userText,
          timestamp: new Date(),
        });

        socket.emit('server:student_text_response', {
          sessionId,
          text: userText,
          role: 'user',
          isFinal: false,
        });
      }
      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            const audioChunk = Buffer.from(part.inlineData.data, 'base64');
            sessionData.currentAiTurnAudioChunks.push(audioChunk);

            socket.emit('server:audio', {
              sessionId,
              audioChunk,
            });
          }
        }
      }

      if (msg.serverContent?.outputTranscription?.text) {
        const aiText = msg.serverContent.outputTranscription.text;
        sessionData.aiTranscript += aiText;
        // console.log('AI transcript:', aiText);
        socket.emit('server:ai_transcript', {
          sessionId,
          text: aiText,
          timestamp: new Date(),
        });
      }

      if (msg.serverContent?.turnComplete) {
        sessionData.turnCount += 1;
        sessionData.lastTurnAt = new Date();

        this.logger.info(`[${sessionId}] Turn ${sessionData.turnCount} completed`);

        let userTurnAudioId = null;
        if (sessionData.currentUserTurnAudioChunks.length > 0) {
          try {
            const result = await this.saveAudioFile(
              sessionData.currentUserTurnAudioChunks,
              {sampleRate: 16000, channels: 1, bitDepth: 16},
              `gemini_user_turn${sessionData.turnCount}_${sessionId}`,
              sessionData.userId,
            );
            userTurnAudioId = result?.fileId || null;
            this.logger.info(`[${sessionId}] Saved user turn ${sessionData.turnCount} audio: ${userTurnAudioId}`);
          } catch (e) {
            this.logger.error(`[${sessionId}] Error saving user turn audio:`, e);
          }
          sessionData.currentUserTurnAudioChunks = [];
        }

        let aiTurnAudioId = null;
        if (sessionData.currentAiTurnAudioChunks.length > 0) {
          try {
            const result = await this.saveAudioFile(
              sessionData.currentAiTurnAudioChunks,
              {sampleRate: 24000, channels: 1, bitDepth: 16},
              `gemini_ai_turn${sessionData.turnCount}_${sessionId}`,
              sessionData.userId,
            );
            aiTurnAudioId = result?.fileId || null;
            this.logger.info(`[${sessionId}] Saved AI turn ${sessionData.turnCount} audio: ${aiTurnAudioId}`);
          } catch (e) {
            this.logger.error(`[${sessionId}] Error saving AI turn audio:`, e);
          }
          sessionData.currentAiTurnAudioChunks = [];
        }

        if (sessionData.userTranscript && sessionData.userTranscript.trim()) {
          sessionData.conversationHistory.push({
            role: 'user',
            content: sessionData.userTranscript.trim(),
            timestamp: new Date(),
            turnAudioId: userTurnAudioId,
          });

          socket.emit('server:student_text_response', {
            sessionId,
            text: sessionData.userTranscript.trim(),
            role: 'user',
            isFinal: true,
            turnAudioId: userTurnAudioId,
          });
        }

        if (sessionData.aiTranscript && sessionData.aiTranscript.trim()) {
          sessionData.conversationHistory.push({
            role: 'assistant',
            content: sessionData.aiTranscript.trim(),
            timestamp: new Date(),
            turnAudioId: aiTurnAudioId,
          });
        }

        socket.emit('server:turn_complete', {
          sessionId,
          turnNumber: sessionData.turnCount,
          userTurnAudioId,
          aiTurnAudioId,
        });

        sessionData.userTranscript = '';
        sessionData.aiTranscript = '';
      }

      if (msg.toolCall) {
        await this.handleToolCall(sessionId, msg.toolCall);
      }
    },

    async handleToolCall(sessionId, toolCall) {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) return;

      this.logger.info(`[${sessionId}] Received tool call:`, JSON.stringify(toolCall));
      console.log(`[${sessionId}] Received tool call:`, JSON.stringify(toolCall));

      for (const functionCall of toolCall.functionCalls || []) {
        const {name, args, id} = functionCall;
        let result = {};

        try {
          switch (name) {
            case 'end_conversation':
              result = await this.handleEndConversationTool(sessionId, args);
              break;
            case 'get_scenario_reference':
              result = await this.handleGetReferenceTool(sessionId, args);
              break;
            default:
              result = {error: `Unknown function: ${name}`};
          }
        } catch (error) {
          this.logger.error(`[${sessionId}] Error handling tool ${name}:`, error);
          result = {error: error.message};
        }

        try {
          sessionData.geminiSession.sendToolResponse({
            functionResponses: [
              {
                id,
                name,
                response: result,
              },
            ],
          });
        } catch (error) {
          this.logger.error(`[${sessionId}] Error sending tool response:`, error);
        }
      }
    },

    async handleEndConversationTool(sessionId, args) {
      const {reason, summary} = args;
      const sessionData = this.sessions.get(sessionId);

      this.logger.info(`[${sessionId}] AI initiated end_conversation: reason=${reason}, summary=${summary}`);

      sessionData.endReason = reason;
      sessionData.endSummary = summary;
      sessionData.aiInitiatedEnd = true;

      sessionData.socket.emit('server:ai_end_conversation', {
        sessionId,
        reason,
        summary,
        timestamp: new Date(),
      });

      return {
        success: true,
        message: 'Cuộc hội thoại sẽ kết thúc sau lời chào tạm biệt của bạn.',
      };
    },

    async handleGetReferenceTool(sessionId, args) {
      const {query} = args;
      const sessionData = this.sessions.get(sessionId);

      this.logger.info(`[${sessionId}] AI requesting reference with query: ${query}`);

      try {
        const scenarioId = sessionData.scenarioId;
        if (!scenarioId) {
          return {found: false, content: 'Không có thông tin kịch bản để tìm tài liệu.'};
        }

        const scenario = await this.broker.call('aiscenarios.get', {
          id: scenarioId,
          populate: ['references'],
        });

        if (!scenario?.references?.length) {
          return {found: false, content: 'Không có tài liệu tham khảo cho kịch bản này.'};
        }

        const queryLower = query.toLowerCase();
        const relevantRefs = scenario.references
          .filter(ref => {
            if (!ref || ref.isDeleted) return false;
            const searchableContent = [ref.name, ref.content].filter(Boolean).join(' ').toLowerCase();
            return searchableContent.includes(queryLower);
          })
          .slice(0, 3);

        if (relevantRefs.length === 0) {
          const fallbackRefs = scenario.references.filter(ref => ref && !ref.isDeleted && ref.content).slice(0, 2);

          if (fallbackRefs.length > 0) {
            const content = fallbackRefs
              .map(ref => `[${ref.name}]: ${ref.content?.substring(0, 800) || 'Không có nội dung'}`)
              .join('\n\n');
            return {found: true, content};
          }

          return {found: false, content: `Không tìm thấy tài liệu liên quan đến "${query}".`};
        }

        const content = relevantRefs
          .map(ref => `[${ref.name}]: ${ref.content?.substring(0, 800) || 'Không có nội dung'}`)
          .join('\n\n');

        return {found: true, content};
      } catch (error) {
        this.logger.error(`[${sessionId}] Error fetching references:`, error);
        return {found: false, content: 'Lỗi khi truy cập tài liệu tham khảo.'};
      }
    },

    async closeAndSaveSession(sessionId) {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) {
        this.logger.warn(`[${sessionId}] Session not found for closing`);
        return {success: false, error: 'Session not found'};
      }

      try {
        if (sessionData.geminiSession) {
          try {
            sessionData.geminiSession.close();
          } catch (e) {
            this.logger.warn(`[${sessionId}] Error closing GeminiLive:`, e.message);
          }
        }

        let lastUserTurnAudioId = null;
        let lastAiTurnAudioId = null;

        if (sessionData.currentUserTurnAudioChunks.length > 0) {
          try {
            const result = await this.saveAudioFile(
              sessionData.currentUserTurnAudioChunks,
              {sampleRate: 16000, channels: 1, bitDepth: 16},
              `gemini_user_final_${sessionId}`,
              sessionData.userId,
            );
            lastUserTurnAudioId = result?.fileId || null;
          } catch (e) {
            this.logger.error(`[${sessionId}] Error saving final user audio:`, e);
          }
        }

        if (sessionData.currentAiTurnAudioChunks.length > 0) {
          try {
            const result = await this.saveAudioFile(
              sessionData.currentAiTurnAudioChunks,
              {sampleRate: 24000, channels: 1, bitDepth: 16},
              `gemini_ai_final_${sessionId}`,
              sessionData.userId,
            );
            lastAiTurnAudioId = result?.fileId || null;
          } catch (e) {
            this.logger.error(`[${sessionId}] Error saving final AI audio:`, e);
          }
        }

        const transcripts = sessionData.conversationHistory.map(item => ({
          role: item.role === 'user' ? 'student' : 'ai',
          content: item.content,
          timestamp: item.timestamp || new Date(),
          audioId: item.turnAudioId || null,
        }));

        if (sessionData.userTranscript && sessionData.userTranscript.trim()) {
          transcripts.push({
            role: 'student',
            content: sessionData.userTranscript.trim(),
            timestamp: new Date(),
            audioId: lastUserTurnAudioId,
          });
        }
        if (sessionData.aiTranscript && sessionData.aiTranscript.trim()) {
          transcripts.push({
            role: 'ai',
            content: sessionData.aiTranscript.trim(),
            timestamp: new Date(),
            audioId: lastAiTurnAudioId,
          });
        }

        const firstUserAudioId = transcripts.find(t => t.role === 'student')?.audioId || null;
        const firstAiAudioId = transcripts.find(t => t.role === 'ai')?.audioId || null;

        const endTime = new Date();
        const duration = (endTime.getTime() - sessionData.startedAt.getTime()) / 1000;
        await this.broker.call('roleplaysessions.update', {
          id: sessionData.dbSessionId,
          isCompleted: true,
          status: 'completed',
          endTime,
          duration,
          transcripts,
          recordingId: firstUserAudioId,
          aiRecordingId: firstAiAudioId,
        });

        this.logger.info(`[${sessionId}] Session data saved to DB`);

        const updatedSession = await this.broker.call('roleplaysessions.get', {
          id: sessionData.dbSessionId,
        });

        this.broker.emit('roleplay.session.completed_for_analysis', {
          sessionId: sessionData.dbSessionId,
          sessionData: updatedSession,
        });

        this.logger.info(`[${sessionId}] Session closed and saved successfully`);

        return {success: true, session: updatedSession};
      } catch (error) {
        this.logger.error(`[${sessionId}] Error closing session:`, error);
        throw error;
      } finally {
        this.sessions.delete(sessionId);
        this.logger.info(`[${sessionId}] Session closed and removed`);
      }
    },

    async saveAudioFile(audioChunks, audioFormat, baseFileName, userId) {
      try {
        const result = await this.broker.call('files.createAudioSessionFile', {
          audioChunks,
          userId,
          baseOutputFileName: baseFileName,
          clientAudioFormat: audioFormat,
          storageFolder: 'roleplay-sessions',
        });

        return {
          fileId: result._id?.toString() || result.id,
          duration: result.duration || 0,
        };
      } catch (error) {
        this.logger.error('Error saving audio file:', error);
        throw error;
      }
    },

    onSocketDisconnect(socket) {
      this.logger.info(`Socket disconnected: ${socket.id}`);

      for (const [sessionId, sessionData] of this.sessions.entries()) {
        if (sessionData.socketId === socket.id) {
          this.logger.info(`[${sessionId}] Closing session due to disconnect`);
          this.closeAndSaveSession(sessionId);
        }
      }
    },
  },

  async created() {
    this.sessions = new Map();

    try {
      const genaiModule = await import('@google/genai');
      GoogleGenAI = genaiModule.GoogleGenAI;
      Modality = genaiModule.Modality;
      this.logger.info('Google GenAI SDK loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load Google GenAI SDK:', error);
      throw error;
    }
  },

  events: {
    'geminilive.client.connected'(socket) {
      this.logger.info(`Client connected to GeminiLive: ${socket.id}`);
      console.log('Client connected to GeminiLive', socket.id);

      socket.on('client:start', data => {
        this.handleStartSession(socket, data);
      });

      socket.on('client:audio', data => {
        this.handleAudioChunk(socket, data);
      });

      socket.on('client:stop', data => {
        this.handleStopSession(socket, data);
      });

      socket.on('client:end_session', data => {
        this.handleEndSession(socket, data);
      });

      socket.on('disconnect', () => {
        this.onSocketDisconnect(socket);
      });
    },
  },

  async started() {
    this.logger.info('GeminiLive service started');
    this.logger.info('Listening for connections on /gemini-live namespace');
  },

  async stopped() {
    this.logger.info('Stopping GeminiLive service, closing all sessions...');

    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeAndSaveSession(sessionId);
      } catch (error) {
        this.logger.error(`Error closing session ${sessionId}:`, error);
      }
    }

    this.logger.info('GeminiLive service stopped');
  },
};
