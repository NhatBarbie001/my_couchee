'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;

// --- PROMPT CONSTANTS ---
const EMOTION_ANALYSIS_SYSTEM_INSTRUCTION = `Bạn là một chuyên gia phân tích cảm xúc trong các cuộc hội thoại.
Nhiệm vụ của bạn là xác định và đánh giá các trạng thái cảm xúc được thể hiện bởi những người tham gia trong cuộc trò chuyện được cung cấp.
Hãy tập trung vào việc xác định các cảm xúc chính và cường độ của chúng. Phân tích cả 'user' (học viên) và 'assistant' (AI Persona).
Chỉ trả lời bằng JSON theo định dạng yêu cầu.`;

const EMOTION_ANALYSIS_USER_PROMPT_TEMPLATE = `Dựa vào lịch sử cuộc trò chuyện sau đây, hãy phân tích cảm xúc của từng người tham gia (Học viên và AI Persona) trong mỗi lượt nói và đưa ra một tóm tắt cảm xúc tổng thể của cuộc trò chuyện.

Lịch sử trò chuyện:
{{conversation_history}}

Hãy trả về kết quả dưới dạng JSON với cấu trúc sau (lý giải cần ngắn gọn, tập trung vào từ khóa hoặc dấu hiệu trong tin nhắn):
\`\`\`json
{
  "overallEmotion": "neutral|positive|negative|mixed",
  "overallIntensity": "low|medium|high",
  "turnByTurnAnalysis": [
    {
      "turn": 1,
      "speaker": "Học viên",
      "message": "Nội dung tin nhắn...",
      "emotion": "happy|sad|angry|surprised|fearful|neutral|joyful|annoyed|confused|curious|etc.",
      "intensity": "low|medium|high",
      "justification": "Giải thích ngắn gọn."
    }
  ],
  "summary": "Một đoạn tóm tắt ngắn về diễn biến cảm xúc trong cuộc trò chuyện, ví dụ: 'Cuộc trò chuyện bắt đầu trung tính, sau đó trở nên tích cực hơn khi học viên thể hiện sự tò mò và AI Persona phản hồi hữu ích.'."
}
\`\`\`
`;
// --- END OF PROMPT CONSTANTS ---

module.exports = {
  name: 'emotionanalysis',
  mixins: [FunctionsCommon],

  settings: {
    maxTokens: 1000,
    temperature: 0.3,
  },

  hooks: {
    before: {
      analyze: ['getAPIKey'],
    },
    after: {},
  },

  actions: {
    analyze: {
      params: {
        conversation: {type: 'array', items: 'object'}, // [{ role: "user"|"assistant", content: "..."}]
      },
      async handler(ctx) {
        const {conversation} = ctx.params;

        if (!conversation || conversation.length === 0) {
          this.logger.warn('Conversation is empty, cannot perform emotion analysis.');
          return {
            overallEmotion: 'neutral',
            overallIntensity: 'low',
            turnByTurnAnalysis: [],
            summary: 'Không có nội dung hội thoại để phân tích cảm xúc.',
          };
        }

        try {
          const formattedConversation = this.formatConversationForPrompt(conversation);
          const userPrompt = EMOTION_ANALYSIS_USER_PROMPT_TEMPLATE.replace(
            '{{conversation_history}}',
            formattedConversation,
          );

          const messages = [
            {role: 'system', content: EMOTION_ANALYSIS_SYSTEM_INSTRUCTION},
            {role: 'user', content: userPrompt},
          ];

          // Lấy model mặc định từ llmsmodel
          const defaultModelData = await ctx.call('llmsmodel.getDefaultModel');
          let modelToUse = 'gpt-4o-mini'; // Fallback model
          let apiKeyToUse = ctx.meta.apiKey; // Fallback to meta apiKey
          const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';

          if (defaultModelData && defaultModelData.gptModel) {
            modelToUse = defaultModelData.gptModel;
            // Sử dụng apiKey từ defaultModelData nếu có
            if (defaultModelData.apiKey) {
              apiKeyToUse = defaultModelData.apiKey;
              this.logger.info(`Using default model and apiKey from llmsmodel: ${modelToUse}`);
            } else {
              this.logger.info(`Using default model from llmsmodel: ${modelToUse}`);
            }
          } else {
            this.logger.warn('No default model found in llmsmodel, using fallback');
          }

          this.logger.info(`Calling ${modelInterface} for emotion analysis with model: ${modelToUse}`);
          console.log('defaultModelData', defaultModelData);
          // Tạo meta mới với apiKey từ llmsmodel nếu có
          const callMeta = {...ctx.meta};
          if (apiKeyToUse) {
            callMeta.apiKey = apiKeyToUse;
          }

          // Gọi LLM dựa trên modelInterface
          const responseContent = await ctx.call(
            modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
            {
              messages,
              model: modelToUse,
              temperature: this.settings.temperature,
              max_tokens: this.settings.maxTokens,
            },
            {meta: callMeta},
          );

          let analysisResult;
          if (responseContent) {
            // sendToOpenAI trả về string content hoặc throw lỗi
            analysisResult = this.parseLLMResponse(responseContent);
          } else {
            // Trường hợp này ít khi xảy ra nếu azureopenai.chatCompletion hoạt động đúng (throw lỗi nếu không có content)
            this.logger.error('Empty response from azureopenai.chatCompletion for emotion analysis.');
            throw new MoleculerClientError(
              'Không nhận được phản hồi từ service phân tích của OpenAI.',
              500,
              'OPENAI_EMPTY_RESPONSE',
            );
          }
          return analysisResult;
        } catch (error) {
          this.logger.error('Error during emotion analysis:', error.message);
          // Nếu lỗi từ ctx.call, nó có thể đã là MoleculerClientError
          if (error instanceof MoleculerClientError) {
            throw error;
          }
          // Trả về một cấu trúc lỗi chuẩn nếu không phân tích được
          throw new MoleculerClientError(
            `Lỗi trong quá trình phân tích cảm xúc: ${error.message}`,
            500,
            'EMOTION_ANALYSIS_FAILED',
            {originalError: error.data},
          );
        }
      },
    },
  },

  events: {
    'roleplaysessions.completed': {
      async handler(payload) {
        // Tự động tạo phân tích cảm xúc khi phiên roleplay hoàn thành
        if (payload.session && payload.session._id) {
          this.logger.info(`Auto-generating emotion analysis for completed session ${payload.session._id}`);

          try {
            // Gọi action analyzeEmotions để tạo phân tích cảm xúc
            await this.broker.call(
              'emotionanalysis.analyzeEmotions',
              {
                sessionId: payload.session._id,
              },
              {meta: {user: {_id: payload.session.createdBy, isSystemAdmin: true}}},
            );
          } catch (error) {
            this.logger.error('Error auto-generating emotion analysis:', error);
          }
        }
      },
    },
  },

  methods: {
    async getAPIKey(ctx) {
      const setting = await ctx.call('settings.findOne');
      const apiKeyFromSettings = setting?.apiKeyOpenAI || process.env.OPENAI_API_KEY;

      if (!apiKeyFromSettings) {
        this.logger.warn('OpenAI API Key not found in settings or environment variables for emotion analysis.');
      }
      ctx.meta.apiKey = apiKeyFromSettings;
      return ctx;
    },

    formatConversationForPrompt(conversation) {
      return conversation
        .map((msg, index) => {
          const speaker = msg.role === 'student' ? 'Học viên' : 'AI Persona';
          return `[Lượt ${index + 1}] ${speaker}: ${msg.content}`;
        })
        .join('\n\n');
    },

    parseLLMResponse(responseContent) {
      try {
        const match = responseContent.match(/```json\n([\s\S]*?)\n```/);
        let jsonString = responseContent;
        if (match && match[1]) {
          jsonString = match[1];
        }
        return JSON.parse(jsonString);
      } catch (error) {
        this.logger.error('Failed to parse JSON response from LLM for emotion analysis:', error);
        this.logger.error('Raw LLM response for emotion analysis:', responseContent);
        return {
          error: true,
          message: 'Lỗi phân tích phản hồi JSON từ LLM.',
          rawResponse: responseContent,
          overallEmotion: 'unknown',
          overallIntensity: 'unknown',
          turnByTurnAnalysis: [],
          summary: 'Không thể phân tích định dạng phản hồi từ AI cho phân tích cảm xúc.',
        };
      }
    },
  },

  async started() {
    this.logger.info('Emotion analysis service started');
  },

  async stopped() {
    this.logger.info('Emotion analysis service stopped');
  },
};
