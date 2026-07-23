'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const FileMixin = require('../../../mixins/file.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const Model = require('./analysis.model');
const { MoleculerClientError } = require('moleculer').Errors;

const ANALYSIS_SYSTEM_INSTRUCTION = `Bạn là một chuyên gia phân tích role play, có kinh nghiệm phân tích trao đổi giữa các học viên và AI persona trong các kịch bản đào tạo kỹ năng.
Nhiệm vụ của bạn là đánh giá chất lượng cuộc trò chuyện và cung cấp phản hồi chi tiết để giúp học viên cải thiện kỹ năng.`;

const KNOWLEDGE_ANALYSIS_INSTRUCTION = `
# PHÂN TÍCH KIẾN THỨC

## Đánh giá chung về Quy trình thành thạo (Proficiency Process) cho toàn bộ Kịch bản:
Cung cấp một đánh giá tổng quan về mức độ học viên nắm vững và thực hiện đúng quy trình chung của kịch bản. Nhận xét này nên tập trung vào khả năng áp dụng các kỹ năng và hiểu bức tranh tổng thể.

## Đánh giá chi tiết cho từng Kỹ năng (Skill) trong Kịch bản:
Với MỖI kỹ năng (skill) đã được cung cấp trong thông tin bối cảnh của kịch bản, hãy đánh giá riêng dựa trên các tiêu chí sau và đưa ra điểm số từ 0-100 CHO TỪNG SKILL:
1.  **Độ chính xác của thông tin và kiến thức chuyên môn được sử dụng LIÊN QUAN ĐẾN SKILL ĐÓ. Chỉ ra các thông tin sai so với tài liệu kịch bản.**
2.  **Khả năng áp dụng đúng quy trình và nguyên tắc LIÊN QUAN ĐẾN SKILL ĐÓ.**
3.  **Xác định các điểm mạnh (strengths) và điểm yếu (weaknesses) của học viên trong việc áp dụng SKILL ĐÓ.**
4.  **Đưa ra các gợi ý (suggestions) cụ thể để cải thiện kỹ năng cho SKILL ĐÓ. Nếu thông tin có trong tài liệu, hãy trích dẫn tài liệu**

LƯU Ý QUAN TRỌNG: Phải có đủ các mục (skillId, skillName, weight, score, details, strengths, weaknesses, suggestions) cho TỪNG SKILL được liệt kê trong bối cảnh. Nếu một skill không có phần hội thoại nào liên quan rõ ràng, hãy ghi nhận điều đó trong phần details của skill đó và cho điểm phù hợp (ví dụ: 0 hoặc N/A nếu không thể đánh giá).
`;

const STYLE_ANALYSIS_INSTRUCTION = `
# PHÂN TÍCH PHONG CÁCH (50% tổng điểm)
Đánh giá phong cách giao tiếp của học viên dựa trên các tiêu chí sau:
1. Rõ ràng (Clarity): Đánh giá mức thấp, trung bình hoặc cao
2. Tốc độ (Pace): Đánh giá dựa trên số từ/phút, mức 140-180 từ/phút là lý tưởng
3. Từ đệm (Filler words): Đánh giá việc sử dụng các từ như "ừm", "à", v.v.
4. Độ dài câu (Sentence length): Đánh giá độ phù hợp, 10-30 từ là tốt nhất
5. Năng lượng (Energy): Đánh giá sự sinh động trong giọng nói và cách diễn đạt

Hãy đưa ra điểm số cho phần này từ 0-100 dựa trên các tiêu chí trên.
`;

const TRAINER_FEEDBACK_INSTRUCTION = `
# PHẢN HỒI HLV (AI TRAINER FEEDBACK)
Đưa ra nhận xét tổng quát về hiệu suất của học viên và các gợi ý cụ thể để cải thiện. Nội dung phản hồi cần:
1. Tóm tắt những điểm mạnh chính
2. Chỉ ra những cơ hội cải thiện quan trọng nhất
3. Đưa ra 2-3 ví dụ cụ thể về cách học viên có thể cải thiện
4. Nhấn mạnh các chiến lược cụ thể mà học viên có thể áp dụng trong tương lai
5. Chỉ ra các lỗi sai của học viên mắc phải và cách họ có thể khắc phục nhất là các lỗi sai so với tài liệu kèm theo
`;

const TURN_EVALUATION_INSTRUCTION = `Bạn là chuyên gia đánh giá role play, nhiệm vụ của bạn là đánh giá từng câu nói của học viên theo kịch bản.

# NHIỆM VỤ:
Đánh giá câu nói của học viên dựa trên:
1. Độ phù hợp với kịch bản và các kỹ năng được yêu cầu
2. Độ chính xác của thông tin (so với tài liệu tham khảo nếu có)
3. Cách diễn đạt, ngôn từ, và phong cách giao tiếp
4. Khả năng tương tác và phản hồi phù hợp với AI persona

# FORMAT PHẢN HỒI:
Nếu câu nói của học viên có ý nghĩa và thuộc về một kỹ năng mềm trong kịch bản thì Trả về dưới dạng JSON với cấu trúc sau:
{
  "type": "soft_skill",
  "feedback": "Nhận xét ngắn gọn về câu nói này (2-3 câu)",
  "suggestions": ["Đề xuất cải thiện 1", "Đề xuất cải thiện 2"],
  "examples": ["Ví dụ câu nói tốt hơn 1 (nếu cần)", "Ví dụ câu nói tốt hơn 2 (nếu cần)"]
}

Nếu câu nói của học viên dùng để trả lời cho câu hỏi vấn đáp hoặc câu hỏi kiểm tra kiến thức thì Trả về dưới dạng JSON với cấu trúc sau:
{
  "type": "knowledge",
  "result": "Nhận xét ngắn gọn về câu trả lời, chỉ ra chỗ sai nếu có",
  "isCorrect": true, // true nếu câu trả lời đúng, false nếu câu trả lời sai
  "correctAnswer": "Đáp án đúng (nếu có)",
}

Nếu câu nói của học viên không có ý nghĩa hoặc không thể đánh giá được thì Trả về chuỗi "null"

LƯU Ý:
- Nếu câu nói tốt, chỉ cần khen ngợi điểm mạnh và có thể để mảng suggestions rỗng
- Chỉ đưa ra examples khi thực sự cần thiết (khi có lỗi rõ ràng hoặc cơ hội cải thiện đáng kể)
- Feedback nên ngắn gọn, dễ hiểu, và mang tính xây dựng`;

const TURN_EVALUATION_INSTRUCTION_NO_STYLE = `Bạn là chuyên gia đánh giá role play, nhiệm vụ của bạn là đánh giá từng câu nói của học viên theo kịch bản.

# NHIỆM VỤ:
Đánh giá câu nói của học viên dựa trên:
1. Độ phù hợp với kịch bản và các kỹ năng được yêu cầu
2. Độ chính xác của thông tin (so với tài liệu tham khảo nếu có)

# FORMAT PHẢN HỒI:
Nếu câu nói của học viên có ý nghĩa và thuộc về một kỹ năng mềm trong kịch bản thì Trả về dưới dạng JSON với cấu trúc sau:
{
  "type": "soft_skill",
  "feedback": "Nhận xét ngắn gọn về câu nói này (2-3 câu)",
  "suggestions": ["Đề xuất cải thiện 1", "Đề xuất cải thiện 2"],
  "examples": ["Ví dụ câu nói tốt hơn 1 (nếu cần)", "Ví dụ câu nói tốt hơn 2 (nếu cần)"]
}

Nếu câu nói của học viên dùng để trả lời cho câu hỏi vấn đáp hoặc câu hỏi kiểm tra kiến thức thì Trả về dưới dạng JSON với cấu trúc sau:
{
  "type": "knowledge",
  "result": "Nhận xét ngắn gọn về câu trả lời, chỉ ra chỗ sai nếu có",
  "isCorrect": true, // true nếu câu trả lời đúng, false nếu câu trả lời sai
  "correctAnswer": "Đáp án đúng (nếu có)",
}

Nếu câu nói của học viên không có ý nghĩa hoặc không thể đánh giá được thì Trả về chuỗi "null"

LƯU Ý:
- Nếu câu nói tốt, chỉ cần khen ngợi điểm mạnh và có thể để mảng suggestions rỗng
- Chỉ đưa ra examples khi thực sự cần thiết (khi có lỗi rõ ràng hoặc cơ hội cải thiện đáng kể)
- Feedback nên ngắn gọn, dễ hiểu, và mang tính xây dựng

**LƯU Ý QUAN TRỌNG:
- Không phân tích về phong cách nói chuyện, cách diễn đạt, ngôn từ của học viên
- Chỉ đánh giá về nội dung và ngữ cảnh của câu nói`;

const TURN_EVALUATION_INSTRUCTION_KNOWLEDGE_TEST = `Bạn là chuyên gia đánh giá role play, nhiệm vụ của bạn là đánh giá từng câu nói của học viên theo kịch bản.

# NHIỆM VỤ:
Đánh giá câu nói của học viên dựa trên:
1. Độ phù hợp với kịch bản và các kỹ năng được yêu cầu
2. Độ chính xác của thông tin (so với tài liệu tham khảo nếu có)

# FORMAT PHẢN HỒI:
Trả về dưới dạng JSON với cấu trúc sau:
{
  "type": "knowledge",
  "result": "Nhận xét ngắn gọn về câu trả lời, chỉ ra chỗ sai nếu có",
  "isCorrect": true, // true nếu câu trả lời đúng, false nếu câu trả lời sai
  "correctAnswer": "Đáp án đúng (nếu có)",
}

Nếu câu nói của học viên chỉ là chào hỏi thông thường hoặc nói chuyện phiếm xã giao thì Trả về chuỗi "null"

**LƯU Ý QUAN TRỌNG:
- Không phân tích về phong cách nói chuyện, cách diễn đạt, ngôn từ của học viên
- Chỉ đánh giá về nội dung và ngữ cảnh của câu nói`;

const NOTE_FOR_KNOWLEDGE_SKILL = `
**LƯU Ý QUAN TRỌNG VỀ CÁCH TÍNH ĐIỂM CHO TỪNG KĨ NĂNG:

* Cách tính score trong skillAnalyses như sau:

  1. Xác định tổng số câu hỏi mà AI dự định hỏi trong kịch bản (dựa vào {conversationInstructionContent}).
  2. Xác định số câu học viên đã trả lời.
  3. Tính điểm tối đa dựa trên tỷ lệ số câu đã trả lời:
     - Điểm tối đa = (Số câu trả lời / Tổng số câu mà AI dự định hỏi trong kịch bản) * 100

  4. Sau đó, đánh giá mức độ chính xác của các câu trả lời để đưa ra điểm cuối cùng:
     - Điểm cuối cùng không được vượt quá điểm tối đa đã tính ở bước trên.

- Ví dụ:
  - Nếu học viên trả lời 3/5 câu → điểm tối đa là 60.
  - Sau khi đánh giá độ chính xác, điểm cuối cùng phải ≤ 60 (có thể thấp hơn nếu trả lời chưa chính xác).

**GHI NHỚ:
  - Số câu hỏi thì ngầm hiểu là số câu hỏi mà AI dự định sẽ hỏi trong kịch bản chứ không phải số câu hỏi mà AI đã hỏi.
  - Học viên không đưa ra câu trả lời cho câu hỏi nào thì đồng nghĩa với việc học viên không trả lời được câu hỏi đó và xem như câu hỏi đó học viên chưa trả lời nhé.
  - Số điểm tối đa cho từng kĩ năng skillAnalyses là 100 thôi nhé (tức là trả lời hết câu hỏi).
  - Số điểm tối đa cho mỗi câu trả lời là 100 chia cho tổng số câu hỏi (dựa vào {conversationInstructionContent}) nhé.
  - Số điểm của skillAnalyses là tổng điểm của từng câu trả lời nhé.
`;

const RESPONSE_FORMAT = `
# FORMAT PHẢN HỒI
Hãy trả lời dưới dạng JSON với cấu trúc sau:
{
  "summary": "Tóm tắt ngắn gọn về hiệu suất tổng thể",
  "topInsights": ["Insight 1", "Insight 2", "Insight 3"],
  "simulationScore": XX, // Tổng điểm (average của styleScore và trung bình có trọng số các skill knowledge scores)
  "knowledgeAnalysis": {
    "proficiencyProcess": "Đánh giá tổng quan về quy trình thành thạo của toàn bộ kịch bản",
    "skillAnalyses": [
      {
        "skillId": "ID của skill 1 (sẽ được cung cấp trong prompt dưới dạng SKILL_ID_xxx)",
        "skillName": "Tên của Skill 1",
        "weight": XX, // Trọng số của skill (%) - sẽ được cung cấp trong prompt
        "score": XX, // Điểm phần kiến thức cho Skill 1 (0-100)
        "details": "Đánh giá chi tiết về kỹ năng cho Skill 1, Nêu đầy đủ lỗi sai của học viên liên quan đến skill 1",
        "strengths": ["Điểm mạnh 1 cho Skill 1", "Điểm mạnh 2 cho Skill 1"],
        "weaknesses": ["Điểm yếu 1 cho Skill 1", "Điểm yếu 2 cho Skill 1"],
        "suggestions": ["Gợi ý 1 cho Skill 1", "Gợi ý 2 cho Skill 1"]
      },
      {
        "skillId": "ID của skill 2",
        "skillName": "Tên của Skill 2",
        "weight": YY,
        "score": YY // Điểm phần kiến thức cho Skill 2 (0-100)
        "details": "Đánh giá chi tiết về kỹ năng cho Skill 2, Nêu đầy đủ lỗi sai của học viên liên quan đến skill 2",
        "strengths": ["Điểm mạnh 1 cho Skill 2"],
        "weaknesses": ["Điểm yếu 1 cho Skill 2"],
        "suggestions": ["Gợi ý 1 cho Skill 2"]
      }
      // ... thêm các skill analyses khác nếu có
    ]
  },
  "styleAnalysis": {
    "score": XX, // Điểm phần phong cách (0-100)
    "clarity": "low/medium/high",
    "pace": {
      "wordsPerMinute": XXX,
      "evaluation": "too slow/good/too fast"
    },
    "fillerWords": {
      "count": XX,
      "evaluation": "Đánh giá về từ đệm"
    },
    "sentenceLength": {
      "average": XX,
      "evaluation": "Đánh giá về độ dài câu"
    },
    "energy": "low/medium/high"
  },
  "trainerFeedback": {
    "generalComments": "Nhận xét tổng quát",
    "improvementSuggestions": ["Gợi ý cải thiện 1", "Gợi ý cải thiện 2", "Gợi ý cải thiện 3"]
  }
}
`;

module.exports = {
  name: 'roleplay.analysises',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, FileMixin],

  settings: {
    entityValidator: {},
    populates: {
      sessionId: 'roleplaysessions.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['sessionId', 'createdBy', 'updatedBy'],
  },

  actions: {
    analyze: {
      rest: 'POST /analyze',
      params: {
        sessionId: 'string',
        options: {
          type: 'object',
          optional: true,
          properties: {
            includeEmotionAnalysis: { type: 'boolean', optional: true, default: false },
            includeSpeechAnalysis: { type: 'boolean', optional: true, default: false },
            includeVideoAnalysis: { type: 'boolean', optional: true, default: false },
            includeSoftSkillsAnalysis: { type: 'boolean', optional: true, default: false },
            includeManagerFeedback: { type: 'boolean', optional: true, default: false },
          },
        },
      },
      async handler(ctx) {
        const { sessionId, options = {}, forceUpdate = false } = ctx.params;
        const creatorUserId = ctx.meta.user?._id;

        return this._performAndSaveAnalysis(sessionId, options, creatorUserId, forceUpdate);
      },
    },

    getAnalysisForSession: {
      rest: 'GET',
      params: {
        sessionId: 'string',
      },
      async handler(ctx) {
        const { sessionId } = ctx.params;

        const analysis = await this.adapter.findOne({ sessionId, isDeleted: false });
        if (!analysis) {
          return null;
        }

        return this.transformDocuments(ctx, {}, analysis);
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
          {_id: {$in: ids}, isDeleted: {$ne: true}},
          {$set: {isDeleted: true, deletedAt: now}},
        );
        const count = result.modifiedCount || result.nModified || 0;
        this.logger.info(`[bulkSoftDelete] Soft-deleted ${count} analyses`);
        return {modifiedCount: count};
      },
    },
  },

  events: {
    'roleplay.session.completed_for_analysis': {
      group: 'local',
      async handler(payload) {
        const { sessionId, sessionData } = payload;

        try {
          const options = {
            includeEmotionAnalysis: false,
            includeSpeechAnalysis: false,
          };
          const creatorUserId = sessionData?.createdBy || sessionData?.studentId;

          if (!creatorUserId) {
            this.logger.warn(
              `Không tìm thấy creatorUserId (từ createdBy hoặc studentId) cho session ${sessionId}. Phân tích có thể không được tạo.`,
            );
            return;
          }

          await this._performAndSaveAnalysis(sessionId, options, creatorUserId);
        } catch (error) {
          this.logger.error(
            `Lỗi khi xử lý sự kiện 'roleplay.session.completed_for_analysis' cho session ${sessionId}:`,
            error,
          );
        }
      },
    },
  },

  methods: {
    async _performAndSaveAnalysis(sessionId, options = {}, creatorUserId, forceUpdate = false) {
      const {
        includeEmotionAnalysis = false,
        includeSpeechAnalysis = false,
        includeVideoAnalysis = false,
        includeSoftSkillsAnalysis = false,
        includeManagerFeedback = false,
      } = options;

      try {
        const existingAnalysis = await this.adapter.findOne({ sessionId, isDeleted: false });
        if (existingAnalysis && !forceUpdate) {
          return existingAnalysis;
        }

        const session = await this.broker.call('roleplaysessions.get', {
          id: sessionId,
          populate: ['courseId', 'courseId.references', 'personaId', 'personaId.roleplayInstructionId', 'studentId', 'recordingId', 'scenarioSkillIds.skillId', 'aiScenarioId'],
        });

        if (!session) {
          throw new MoleculerClientError(`Không tìm thấy phiên thực hành ${sessionId} để phân tích`, 404);
        }

        const aiScenario = session.aiScenarioId;
        const persona = session.personaId;
        const enableStyleAnalysis = aiScenario?.enableStyleAnalysis ?? false;
        const simulationFormatAnalysis = aiScenario?.simulationFormat ?? 'dialogue';
        const conversationInstruction = persona?.roleplayInstructionId?.conversationInstruction || '';

        const conversationHistory = session.transcripts;

        if (!conversationHistory || conversationHistory.length === 0) {
          const skillAnalyses = [];
          if (session.scenarioSkillIds && session.scenarioSkillIds.length > 0) {
            session.scenarioSkillIds.forEach(scenarioSkill => {
              const skill = scenarioSkill.skillId;
              if (skill) {
                skillAnalyses.push({
                  skillId: skill._id.toString(),
                  skillName: skill.name || 'Không có tên',
                  weight: scenarioSkill.weight || 0,
                  score: 0,
                  details: 'Không có dữ liệu hội thoại để đánh giá kỹ năng này.',
                  strengths: [],
                  weaknesses: ['Không có cuộc hội thoại nào được ghi nhận'],
                  suggestions: ['Hãy thử lại phiên thực hành và đảm bảo có tương tác với AI Persona'],
                });
              }
            });
          }

          const zeroScoreResult = {
            summary: 'Không có dữ liệu cuộc hội thoại để phân tích.',
            topInsights: [
              'Phiên thực hành không có nội dung hội thoại',
              'Không thể đánh giá kỹ năng do thiếu dữ liệu',
              'Vui lòng thực hiện lại phiên thực hành với tương tác đầy đủ',
            ],
            simulationScore: 0,
            knowledgeAnalysis: {
              proficiencyProcess:
                'Không có dữ liệu để đánh giá quy trình thành thạo. Phiên thực hành không có nội dung hội thoại được ghi nhận.',
              skillAnalyses: skillAnalyses,
              score: 0,
            },
            trainerFeedback: {
              generalComments:
                'Phiên thực hành này không có nội dung hội thoại được ghi nhận. Điều này có thể do: (1) phiên chưa được bắt đầu, (2) không có tương tác nào giữa học viên và AI, hoặc (3) lỗi kỹ thuật trong quá trình ghi nhận. Vui lòng thực hiện lại phiên thực hành và đảm bảo có tương tác đầy đủ để nhận được đánh giá chính xác.',
              improvementSuggestions: [
                'Đảm bảo kết nối internet ổn định trong suốt phiên thực hành',
                'Tương tác tích cực với AI bằng cách trả lời các câu hỏi và đưa ra phản hồi',
                'Kiểm tra thiết bị âm thanh (microphone) hoạt động tốt trước khi bắt đầu',
              ],
            },
            emotionAnalysis: null,
            videoAnalysis: null,
            softSkillsAnalysis: null,
            managerFeedback: null,
          };

          if (enableStyleAnalysis) {
            zeroScoreResult.styleAnalysis = {
              score: 0,
              clarity: 'low',
              pace: {
                wordsPerMinute: 0,
                evaluation: 'Không có dữ liệu',
              },
              fillerWords: {
                count: 0,
                evaluation: 'Không có dữ liệu để đánh giá',
              },
              sentenceLength: {
                average: 0,
                evaluation: 'Không có dữ liệu',
              },
              energy: 'low',
            };
          }

          const analysis = await this.adapter.insert({
            sessionId,
            result: zeroScoreResult,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: creatorUserId,
            isDeleted: false,
          });

          this.broker.emit('roleplay.analysis.completed', {
            sessionId: sessionId,
            analysisId: analysis._id.toString(),
            analysisData: analysis,
            session: session,
          });

          this.logger.info(`Đã tạo phân tích với điểm 0 cho session ${sessionId} do không có transcripts`);
          return analysis;
        }

        const course = session.courseId; // courseId từ session
        // console.log('##############course', course);

        if (!session.scenarioSkillIds || session.scenarioSkillIds.length === 0) {
          this.logger.warn(
            `Session ${sessionId} không có thông tin scenarioSkillIds (danh sách skills) hoặc rỗng. Phân tích có thể không chính xác.`,
          );
        }

        // Bước 1: Đánh giá từng câu trước để lấy nhận xét chi tiết làm context cho phân tích tổng thể
        this.logger.info(`Bắt đầu đánh giá từng câu nói của học viên (bước đầu) cho session ${sessionId}`);
        console.time('studentTurnEvaluationTime===============');
        const evaluatedTranscripts = await this.evaluateStudentTurns(
          conversationHistory,
          persona,
          course,
          session,
          enableStyleAnalysis,
          simulationFormatAnalysis,
        ).catch(err => {
          this.logger.warn(`Per-turn evaluation failed for session ${sessionId}:`, err);
          return null;
        });
        console.timeEnd('studentTurnEvaluationTime===============');

        // Bước 2: Chạy song song phân tích tổng thể (giờ có thêm context từng câu) và các phân tích khác
        console.time('parallelAnalysisTime===============');

        const [
          analysisResult,
          speechAnalysis,
          emotionAnalysis,
          videoAnalysis,
          softSkillsAnalysis,
          managerFeedbackResult,
        ] = await Promise.all([
          this.performAnalysis(conversationHistory, persona, course, session, conversationInstruction, enableStyleAnalysis, evaluatedTranscripts, simulationFormatAnalysis),

          includeSpeechAnalysis && session.recordingId
            ? this.analyzeSpeech(session).catch(err => {
              this.logger.warn(`Speech analysis failed for session ${sessionId}:`, err);
              return null;
            })
            : Promise.resolve(null),

          includeEmotionAnalysis
            ? this.analyzeEmotions(conversationHistory).catch(err => {
              this.logger.warn(`Emotion analysis failed for session ${sessionId}:`, err);
              return null;
            })
            : Promise.resolve(null),

          includeVideoAnalysis
            ? this.broker.call('roleplay.videoanalysis.analyze', { sessionId }).catch(err => {
              this.logger.warn(`Video analysis failed for session ${sessionId}:`, err);
              return null;
            })
            : Promise.resolve(null),

          includeSoftSkillsAnalysis
            ? this.broker.call('roleplay.softskillsanalysis.analyze', { sessionId }).catch(err => {
              this.logger.warn(`Soft skills analysis failed for session ${sessionId}:`, err);
              return null;
            })
            : Promise.resolve(null),

          includeManagerFeedback
            ? this.broker.call('roleplay.managerfeedback.getForSession', { sessionId }).catch(err => {
              this.logger.warn(`Manager feedback retrieval failed for session ${sessionId}:`, err);
              return null;
            })
            : Promise.resolve(null),
        ]);

        console.timeEnd('parallelAnalysisTime===============');

        // Combine all analysis results
        const finalResult = this.combineAnalysisResults(
          analysisResult,
          speechAnalysis,
          emotionAnalysis,
          enableStyleAnalysis,
        );
        // Gán các kết quả phân tích mở rộng
        finalResult.videoAnalysis = videoAnalysis;
        finalResult.softSkillsAnalysis = softSkillsAnalysis;
        finalResult.managerFeedback = managerFeedbackResult;

        // Lưu kết quả đánh giá từng câu vào session
        this.logger.info(`Lưu đánh giá từng câu cho session ${sessionId}`);
        if (evaluatedTranscripts && evaluatedTranscripts.length > 0) {
          await this.broker.call('roleplaysessions.update', {
            id: sessionId,
            transcripts: evaluatedTranscripts,
          });
          this.logger.info(
            `Đã cập nhật ${evaluatedTranscripts.length} transcripts với đánh giá cho session ${sessionId}`,
          );
        }

        // Lưu kết quả phân tích vào cơ sở dữ liệu
        const analysis = await this.adapter.insert({
          sessionId,
          result: finalResult,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: creatorUserId, // Sử dụng creatorUserId được truyền vào
          isDeleted: false,
        });

        // Phát sự kiện sau khi phân tích thành công
        this.broker.emit('roleplay.analysis.completed', {
          sessionId: sessionId,
          analysisId: analysis._id.toString(),
          analysisData: analysis, // Gửi kèm dữ liệu analysis nếu cần
          session: session,
        });
        this.logger.info(
          `Đã phân tích và phát sự kiện 'roleplay.analysis.completed' cho sessionId: ${sessionId}, analysisId: ${analysis._id}`,
        );

        return analysis;
      } catch (error) {
        this.logger.error(`Lỗi trong _performAndSaveAnalysis cho session ${sessionId}:`, error);
        // Không ném lỗi ở đây để event handler không bị crash, nhưng ghi log lỗi
        // Hoặc có thể throw lỗi nếu muốn transaction bị rollback hoặc xử lý ở tầng cao hơn
        // throw new MoleculerClientError(`Không thể thực hiện và lưu phân tích cho session ${sessionId}`, 500, error.message);
        return null; // Trả về null nếu có lỗi để không làm crash flow của event
      }
    },

    /**
     * Thực hiện phân tích cuộc trò chuyện
     */
    async performAnalysis(conversationHistory, persona, course, session, conversationInstruction, enableStyleAnalysis = false, evaluatedTranscripts = null, simulationFormatAnalysis = 'dialogue') {
      try {
        // console.log('enableStyleAnalysis', enableStyleAnalysis);
        const formattedConversation = this.formatConversationForAnalysis(conversationHistory);

        const prompt = this.buildAnalysisPrompt(formattedConversation, persona, course, session, conversationInstruction, enableStyleAnalysis, evaluatedTranscripts, simulationFormatAnalysis);

        // console.log('prompt ', prompt);

        let defaultModelData;
        if (persona.llmModelId) {
          defaultModelData = await this.broker.call('llmsmodel.getDetailsModel', { id: persona.llmModelId });
        } else {
          defaultModelData = await this.broker.call('llmsmodel.getDefaultModel');
        }

        const { apiKey, model, endpoint } = defaultModelData;
        const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';

        const MAX_RETRIES = 2;
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            console.time(`openAIAnalysisTime_Attempt_${attempt}===============`);
            const analysisResponse = await this.broker.call(
              modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
              {
                messages: [
                  { role: 'system', content: prompt },
                  { role: 'user', content: 'Phân tích cuộc hội thoại trên và đưa ra kết quả đánh giá chi tiết.' },
                ],
                temperature: 0.3,
                max_tokens: 16000,
                apiKey,
                model,
                endpoint,
              },
            );
            console.timeEnd(`openAIAnalysisTime_Attempt_${attempt}===============`);

            return this.parseAnalysisResponse(analysisResponse, session.scenarioSkillIds, enableStyleAnalysis);
          } catch (error) {
            console.timeEnd(`openAIAnalysisTime_Attempt_${attempt}===============`);
            this.logger.warn(`Lỗi phân tích lần ${attempt}: ${error.message}`);
            lastError = error;
            if (attempt === MAX_RETRIES) {
              break;
            }
          }
        }

        this.logger.error('Lỗi trong quá trình phân tích sau tất cả các lần thử:', lastError);
        throw lastError;
      } catch (error) {
        this.logger.error('Lỗi tạo prompt phân tích hoặc config:', error);
        throw error;
      }
    },

    async analyzeSpeech(session) {
      try {
        if (!session.recordingId || !session.transcripts || session.transcripts.length === 0) {
          this.logger.warn(`Phân tích giọng nói cho session ${session._id}: Thiếu recordingId hoặc transcripts.`);
          return null;
        }

        const audioFile = await this.broker.call('files.get', { id: session.recordingId });
        if (!audioFile) {
          this.logger.warn(
            `Phân tích giọng nói cho session ${session._id}: Không tìm thấy file ghi âm với ID ${session.recordingId}.`,
          );
          return null;
        }

        const audioLength = session.duration || 300;

        const studentTranscript = session.transcripts
          .filter(t => t.role === 'student' && t.content)
          .map(t => t.content.trim())
          .join(' \n');

        if (!studentTranscript) {
          this.logger.warn(
            `Phân tích giọng nói cho session ${session._id}: Không có transcript của học viên để phân tích.`,
          );
          return null;
        }

        return this.broker.call('roleplay.speechprocessing.analyzeSpeech', {
          transcript: studentTranscript,
          audioLength,
        });
      } catch (error) {
        this.logger.warn(`Không thể phân tích giọng nói cho session ${session?._id}:`, error.message);
        return null;
      }
    },

    async analyzeEmotions(conversationHistory) {
      try {
        return this.broker.call('emotionanalysis.analyze', {
          conversation: conversationHistory,
        });
      } catch (error) {
        this.logger.warn('Không thể phân tích cảm xúc:', error.message);
        return null;
      }
    },

    combineAnalysisResults(basicAnalysis, speechAnalysis, emotionAnalysis, enableStyleAnalysis = false) {
      const combinedResult = JSON.parse(JSON.stringify(basicAnalysis));

      if (enableStyleAnalysis && speechAnalysis) {
        combinedResult.styleAnalysis.pace = {
          wordsPerMinute: speechAnalysis.wordsPerMinute,
          evaluation: this.evaluatePace(speechAnalysis.wordsPerMinute),
        };

        combinedResult.styleAnalysis.fillerWords = {
          count: speechAnalysis.fillerWords.total,
          percentage: speechAnalysis.fillerWords.percentage.toFixed(2),
          details: speechAnalysis.fillerWords.details,
          evaluation: this.evaluateFillerWords(speechAnalysis.fillerWords.percentage),
        };

        combinedResult.styleAnalysis.sentenceLength = {
          average: speechAnalysis.sentences.averageLength.toFixed(1),
          evaluation: this.evaluateSentenceLength(speechAnalysis.sentences.averageLength),
        };
      }

      if (emotionAnalysis) {
        combinedResult.emotionAnalysis = emotionAnalysis;
      }

      if (typeof combinedResult.videoAnalysis === 'undefined') {
        combinedResult.videoAnalysis = null;
      }
      if (typeof combinedResult.softSkillsAnalysis === 'undefined') {
        combinedResult.softSkillsAnalysis = null;
      }
      if (typeof combinedResult.managerFeedback === 'undefined') {
        combinedResult.managerFeedback = null;
      }

      if (
        combinedResult.knowledgeAnalysis &&
        combinedResult.knowledgeAnalysis.skillAnalyses &&
        combinedResult.knowledgeAnalysis.skillAnalyses.length > 0
      ) {
        const validSkillScores = combinedResult.knowledgeAnalysis.skillAnalyses
          .map(sa => sa.score * sa.weight)
          .filter(score => typeof score === 'number' && !isNaN(score));

        if (validSkillScores.length > 0) {
          combinedResult.knowledgeAnalysis.score = validSkillScores.reduce((sum, score) => sum + score, 0) / 100;

          if (
            enableStyleAnalysis &&
            combinedResult.styleAnalysis &&
            typeof combinedResult.styleAnalysis.score === 'number'
          ) {
            combinedResult.simulationScore = Math.round(
              (combinedResult.knowledgeAnalysis.score + combinedResult.styleAnalysis.score) / 2,
            );
          } else {
            combinedResult.simulationScore = Math.round(combinedResult.knowledgeAnalysis.score);
          }
        } else {
          if (
            enableStyleAnalysis &&
            combinedResult.styleAnalysis &&
            typeof combinedResult.styleAnalysis.score === 'number'
          ) {
            combinedResult.simulationScore = combinedResult.styleAnalysis.score;
          } else {
            combinedResult.simulationScore = 0;
          }
        }
      } else if (
        enableStyleAnalysis &&
        combinedResult.styleAnalysis &&
        typeof combinedResult.styleAnalysis.score === 'number'
      ) {
        combinedResult.simulationScore = combinedResult.styleAnalysis.score;
      } else {
        combinedResult.simulationScore = 0;
      }

      return combinedResult;
    },

    formatConversationForAnalysis(conversationHistory) {
      return conversationHistory
        .map((message, index) => {
          const role = message.role === 'student' ? 'Học viên' : 'AI Persona';
          return `[${index + 1}] ${role}: ${message.content}`;
        })
        .join('\n\n');
    },

    buildAnalysisPrompt(formattedConversation, persona, course, session, conversationInstruction, enableStyleAnalysis = false, evaluatedTranscripts = null, simulationFormatAnalysis = 'dialogue') {
      let skillsInformationForContext = 'Các tiêu chí đánh giá (Skills):\n';
      let skillsInformationForGuidance = '\n\n## Hướng dẫn chi tiết cho việc phân tích từng Kỹ năng:\n';

      if (session && session.scenarioSkillIds && session.scenarioSkillIds.length > 0) {
        session.scenarioSkillIds.forEach((scenarioSkill, index) => {
          const skill = scenarioSkill.skillId; // skillId đã được populate
          if (!skill) {
            this.logger.warn(
              `ScenarioSkill at index ${index} has no populated skillId. ScenarioSkill ID: ${scenarioSkill._id || 'unknown'}`,
            );
            return;
          }

          const skillIdentifier = `SKILL_ID_${skill._id}`;
          skillsInformationForContext += `  Kỹ năng ${index + 1}: ${skill.name || 'Không có tên'} (ID để tham chiếu: ${skillIdentifier})\n`;
          skillsInformationForContext += `    Trọng số: ${scenarioSkill.weight}%\n`;
          if (skill.instruction) {
            skillsInformationForContext += `    Hướng dẫn đánh giá: ${skill.instruction}\n`;
          }
          skillsInformationForContext += '  ---\n';

          skillsInformationForGuidance += `Đối với kỹ năng "${skill.name || 'Không có tên'}" (ID: ${skillIdentifier}), hãy cung cấp phân tích trong mảng 'skillAnalyses' với:\n`;
          skillsInformationForGuidance += `  - 'skillId': '${skillIdentifier}'\n`;
          skillsInformationForGuidance += `  - 'skillName': '${skill.name || 'Không có tên'}'\n`;
          skillsInformationForGuidance += `  - 'weight': ${scenarioSkill.weight}\n`;
          skillsInformationForGuidance += `  - 'score': điểm từ 0-100\n`;
          skillsInformationForGuidance += `  - 'details': mô tả chi tiết đánh giá\n`;
          skillsInformationForGuidance += `  - 'strengths': mảng các điểm mạnh\n`;
          skillsInformationForGuidance += `  - 'weaknesses': mảng các điểm yếu\n`;
          skillsInformationForGuidance += `  - 'suggestions': mảng các gợi ý cải thiện\n\n`;
        });
      } else {
        skillsInformationForContext = 'Không có tiêu chí đánh giá cụ thể nào được cấu hình.\n';
        skillsInformationForGuidance = '';
      }

      let referencesContent = '';
      if (course && course.references && course.references.length > 0) {
        referencesContent = '\n# TÀI LIỆU THAM KHẢO KHÓA HỌC\n';
        try {
          const referencesInfo = course.references.map(reference => {
            try {
              if (reference && !reference.isDeleted) {
                let refInfo = `## ${reference.name || 'Tài liệu không tên'}\n`;
                if (reference.description) {
                  refInfo += `Mô tả: ${reference.description}\n`;
                }
                if (reference.content) {
                  refInfo += `Nội dung:\n${reference.content}\n`;
                } else if (reference.url) {
                  refInfo += `URL: ${reference.url}\n`;
                }
                refInfo += '---\n';
                return refInfo;
              }
              return null;
            } catch (error) {
              this.logger.warn(`Không thể lấy thông tin reference ${reference}:`, error.message);
              return null;
            }
          });

          referencesContent += referencesInfo.filter(Boolean).join('\n');

          if (!referencesInfo.filter(Boolean).length) {
            referencesContent = '';
          }
        } catch (error) {
          this.logger.warn('Lỗi khi lấy thông tin references:', error.message);
          referencesContent = '';
        }
      }

      let conversationInstructionContent = '';
      if (conversationInstruction && simulationFormatAnalysis === 'knowledge_test') {
        conversationInstructionContent = `
        # HƯỚNG DẪN CUỘC TRÒ CHUYỆN\n
        (Đây là hướng dẫn cho cuộc trò chuyện, hãy sử dụng làm cơ sở xác định số câu hỏi tổng thể và chấm điểm chính xác hơn cho từng câu trả lời của học viên)\n
        ${conversationInstruction}
        `;
      }

      let scenarioInformation = '';
      if (session && session.aiScenarioId) {
        scenarioInformation = '\n# THÔNG TIN KỊCH BẢN\n';
        if (session.aiScenarioId.aiDescription) {
          scenarioInformation += `## Mô tả cho AI Persona:\n${session.aiScenarioId.aiDescription}\n\n`;
        }
        if (session.aiScenarioId.studentDescription) {
          scenarioInformation += `## Mô tả cho Học viên:\n${session.aiScenarioId.studentDescription}\n\n`;
        }
      }

      let contextInfo = `
        # THÔNG TIN BỐI CẢNH
        - Tên AI Persona: ${persona?.name || 'Không có thông tin'}
        - Vai trò AI Persona: ${persona?.role || 'Không có thông tin'}
        - Khóa học: ${course?.name || 'Không có thông tin'}
        ${skillsInformationForContext}
        - Thời gian phiên: ${this.formatDuration(session?.startedAt, session?.endedAt)}
        `;

      const finalKnowledgeAnalysisInstruction = KNOWLEDGE_ANALYSIS_INSTRUCTION.replace(
        'LƯU Ý QUAN TRỌNG:',
        `${skillsInformationForGuidance}\nLƯU Ý QUAN TRỌNG:`,
      );

      let customResponseFormat = RESPONSE_FORMAT;
      if (!enableStyleAnalysis) {
        customResponseFormat = `
          # FORMAT PHẢN HỒI
          Hãy trả lời dưới dạng JSON với cấu trúc sau:
          {
            "summary": "Tóm tắt ngắn gọn về hiệu suất tổng thể",
            "topInsights": ["Insight 1", "Insight 2", "Insight 3"],
            "simulationScore": XX, // Tổng điểm (trung bình có trọng số các skill knowledge scores)
            "knowledgeAnalysis": {
              "proficiencyProcess": "Đánh giá tổng quan về quy trình thành thạo của toàn bộ kịch bản",
              "skillAnalyses": [
                {
                  "skillId": "ID của skill 1 (sẽ được cung cấp trong prompt dưới dạng SKILL_ID_xxx)",
                  "skillName": "Tên của Skill 1",
                  "weight": XX, // Trọng số của skill (%) - sẽ được cung cấp trong prompt
                  "score": XX, // Điểm phần kiến thức cho Skill 1 (0-100)
                  "details": "Đánh giá chi tiết về kỹ năng cho Skill 1, Nêu đầy đủ lỗi sai của học viên liên quan đến skill 1",
                  "strengths": ["Điểm mạnh 1 cho Skill 1", "Điểm mạnh 2 cho Skill 1"],
                  "weaknesses": ["Điểm yếu 1 cho Skill 1", "Điểm yếu 2 cho Skill 1"],
                  "suggestions": ["Gợi ý 1 cho Skill 1", "Gợi ý 2 cho Skill 1"]
                }
                // ... thêm các skill analyses khác nếu có
              ]
            },
            "trainerFeedback": {
              "generalComments": "Nhận xét tổng quát",
              "improvementSuggestions": ["Gợi ý cải thiện 1", "Gợi ý cải thiện 2", "Gợi ý cải thiện 3"]
            }
          }

          LƯU Ý: Không cần đánh giá phong cách nói chuyện, ngôn từ, cách diễn đạt của học viên trong kịch bản này.
        `;
      }

      const styleInstruction = enableStyleAnalysis ? `\n\n${STYLE_ANALYSIS_INSTRUCTION}` : '';

      // Build section nhận xét chi tiết từng câu (nếu có)
      let perTurnEvaluationsSection = '';
      if (evaluatedTranscripts && evaluatedTranscripts.length > 0) {
        const studentEvaluations = evaluatedTranscripts.filter(
          t => t.role === 'student' && t.evaluation && (t.evaluation.feedback || t.evaluation.result),
        );
        if (studentEvaluations.length > 0) {
          perTurnEvaluationsSection = '\n\n# NHẬN XÉT CHI TIẾT TỪNG LƯỢT NÓI CỦA HỌC VIÊN\n';
          perTurnEvaluationsSection += '(Đây là đánh giá chi tiết từng câu đã thực hiện, hãy sử dụng làm cơ sở cho phân tích tổng thể và chấm điểm chính xác hơn cho từng câu nói của học viên)\n';
          let turnNum = 1;
          studentEvaluations.forEach(t => {
            perTurnEvaluationsSection += `\n## Lượt ${turnNum++}: "${t.content}"\n`;
            if (t.evaluation.feedback) {
              perTurnEvaluationsSection += `- Nhận xét: ${t.evaluation.feedback}\n`;
            }
            if (t.evaluation.result) {
              perTurnEvaluationsSection += `- Kết quả: ${t.evaluation.result}\n- Đúng/Sai: ${t.evaluation.isCorrect ? 'Đúng' : 'Sai'}\n`;
            }
            if (t.evaluation.correctAnswer) {
              perTurnEvaluationsSection += `- Câu trả lời đúng: ${t.evaluation.correctAnswer}\n`;
            }
            if (Array.isArray(t.evaluation.suggestions) && t.evaluation.suggestions.length > 0) {
              perTurnEvaluationsSection += `- Gợi ý cải thiện: ${t.evaluation.suggestions.join('; ')}\n`;
            }
          });
        }
      }

      const noteForKnowledgeSkill = simulationFormatAnalysis === 'knowledge_test' ? NOTE_FOR_KNOWLEDGE_SKILL : '';

      return `${ANALYSIS_SYSTEM_INSTRUCTION}\n\n${scenarioInformation}${contextInfo}${referencesContent}\n\n# NỘI DUNG CUỘC TRÒ CHUYỆN\n${formattedConversation}\n${perTurnEvaluationsSection}\n\n${conversationInstructionContent}\n\n${finalKnowledgeAnalysisInstruction}${styleInstruction}\n\n${TRAINER_FEEDBACK_INSTRUCTION}\n\n${customResponseFormat}\n\n${noteForKnowledgeSkill}`;
    },

    parseAnalysisResponse(analysisResponse, scenarioSkills, enableStyleAnalysis = false) {
      try {
        const jsonStartIndex = analysisResponse.indexOf('{');
        const jsonEndIndex = analysisResponse.lastIndexOf('}') + 1;

        if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
          let jsonString = analysisResponse.substring(jsonStartIndex, jsonEndIndex);
          let parsedJson;

          try {
            parsedJson = JSON.parse(jsonString);
          } catch (err) {
            this.logger.warn(`Lỗi parse JSON lần 1: ${err.message}. Đang thử sửa chuỗi JSON...`);

            // Sửa key có nháy đơn thành nháy kép
            jsonString = jsonString.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');

            // Sửa key không có nháy thành nháy kép
            jsonString = jsonString.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');

            // Xóa dấu phẩy thừa (trailing commas) ở cuối object/mảng
            jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');

            // Thay thế giá trị dùng nháy đơn thành nháy kép một cách an toàn nhất có thể (nếu match)
            // (Chỉ áp dụng cho string value không chứa nháy kép)
            jsonString = jsonString.replace(/:\s*'([^']*)'/g, ':"$1"');

            try {
              parsedJson = JSON.parse(jsonString);
              this.logger.info(`Đã khắc phục chuỗi JSON thành công.`);
            } catch (err2) {
              this.logger.error(`Dọn dẹp chuỗi JSON thất bại. Lỗi: ${err2.message}`);
              throw err2;
            }
          }

          if (parsedJson.knowledgeAnalysis && !Array.isArray(parsedJson.knowledgeAnalysis.skillAnalyses)) {
            parsedJson.knowledgeAnalysis.skillAnalyses = [];
          }

          if (parsedJson.knowledgeAnalysis && parsedJson.knowledgeAnalysis.skillAnalyses) {
            parsedJson.knowledgeAnalysis.skillAnalyses = parsedJson.knowledgeAnalysis.skillAnalyses.map(sa => {
              let finalSkillId = null;
              if (sa.skillId && typeof sa.skillId === 'string' && sa.skillId.startsWith('SKILL_ID_')) {
                finalSkillId = sa.skillId.substring('SKILL_ID_'.length);
              } else {
                finalSkillId = sa.skillId || null;
              }
              const scenarioSkill = scenarioSkills?.find(ss => ss.skillId?._id?.toString() === finalSkillId);

              return {
                skillId: finalSkillId,
                skillName: sa.skillName || 'N/A',
                score: typeof sa.score === 'number' ? sa.score : 0,
                weight: scenarioSkill?.weight || 0,
                details: sa.details || 'Không có chi tiết.',
                strengths: Array.isArray(sa.strengths) ? sa.strengths : [],
                weaknesses: Array.isArray(sa.weaknesses) ? sa.weaknesses : [],
                suggestions: Array.isArray(sa.suggestions) ? sa.suggestions : [],
              };
            });
          }

          if (!enableStyleAnalysis) {
            delete parsedJson.styleAnalysis;
          }

          return parsedJson;
        } else {
          this.logger.warn('Không tìm thấy JSON hợp lệ trong phản hồi phân tích. Trả về cấu trúc mặc định.');
          const defaultResult = {
            summary: 'Không thể phân tích định dạng phản hồi',
            topInsights: ['Cần phân tích lại'],
            simulationScore: 0,
            knowledgeAnalysis: {
              proficiencyProcess: 'Không có thông tin',
              skillAnalyses: [],
            },
            trainerFeedback: {
              generalComments: 'Lỗi phân tích phản hồi',
              improvementSuggestions: [],
            },
            emotionAnalysis: null,
            videoAnalysis: null,
            softSkillsAnalysis: null,
            managerFeedback: null,
          };

          if (enableStyleAnalysis) {
            defaultResult.styleAnalysis = {
              score: 0,
              clarity: 'medium',
              pace: { wordsPerMinute: 0, evaluation: 'N/A' },
              fillerWords: { count: 0, evaluation: 'N/A' },
              sentenceLength: { average: 0, evaluation: 'N/A' },
              energy: 'medium',
            };
          }

          return defaultResult;
        }
      } catch (error) {
        this.logger.error('Lỗi khi phân tích phản hồi JSON:', error);
        const errorResult = {
          summary: 'Không thể phân tích',
          topInsights: ['Cần phân tích lại'],
          simulationScore: 0,
          knowledgeAnalysis: {
            proficiencyProcess: 'Không thể phân tích',
            skillAnalyses: [],
          },
          trainerFeedback: {
            generalComments: 'Không thể phân tích',
            improvementSuggestions: [],
          },
          emotionAnalysis: null,
          videoAnalysis: null,
          softSkillsAnalysis: null,
          managerFeedback: null,
        };

        if (enableStyleAnalysis) {
          errorResult.styleAnalysis = {
            score: 0,
            clarity: 'medium',
            pace: { wordsPerMinute: 0, evaluation: 'N/A' },
            fillerWords: { count: 0, evaluation: 'N/A' },
            sentenceLength: { average: 0, evaluation: 'N/A' },
            energy: 'medium',
          };
        }

        return errorResult;
      }
    },

    evaluatePace(wordsPerMinute) {
      if (wordsPerMinute < 120) return 'quá chậm';
      if (wordsPerMinute > 180) return 'quá nhanh';
      return 'tốt';
    },

    evaluateFillerWords(percentage) {
      if (percentage < 3) return 'rất tốt';
      if (percentage < 7) return 'tốt';
      if (percentage < 15) return 'cần cải thiện';
      return 'quá nhiều từ đệm';
    },

    evaluateSentenceLength(averageLength) {
      if (averageLength < 5) return 'câu quá ngắn';
      if (averageLength > 30) return 'câu quá dài';
      return 'độ dài câu phù hợp';
    },

    async evaluateStudentTurns(conversationHistory, persona, course, session, enableStyleAnalysis = false, simulationFormatAnalysis = 'dialogue') {
      try {
        const updatedTranscripts = [];
        const BATCH_SIZE = 5;
        const studentTurnGroups = [];
        let i = 0;

        while (i < conversationHistory.length) {
          const turn = conversationHistory[i];

          if (turn.role === 'student') {
            const consecutiveStudentTurns = [turn];
            let j = i + 1;
            while (j < conversationHistory.length && conversationHistory[j].role === 'student') {
              consecutiveStudentTurns.push(conversationHistory[j]);
              j++;
            }

            studentTurnGroups.push({ turns: consecutiveStudentTurns, startIndex: i });
            i = j;
          } else {
            i++;
          }
        }

        const evaluationResults = new Map();
        for (let b = 0; b < studentTurnGroups.length; b += BATCH_SIZE) {
          const batch = studentTurnGroups.slice(b, b + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(group =>
              this.evaluateStudentTurn(
                group.turns.map(t => t.content).join('. '),
                group.startIndex,
                conversationHistory,
                persona,
                course,
                session,
                group.turns.length,
                enableStyleAnalysis,
                simulationFormatAnalysis,
              ).catch(err => {
                this.logger.warn(`Evaluation failed for turn at index ${group.startIndex}:`, err);
                return null;
              })
            )
          );
          batch.forEach((group, idx) => {
            evaluationResults.set(group.startIndex, batchResults[idx]);
          });
        }

        i = 0;
        while (i < conversationHistory.length) {
          const turn = conversationHistory[i];
          const transcript = {
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp || new Date(),
            audioId: turn.audioId || null,
            duration: turn.duration || 0,
            speakSpeed: turn.speakSpeed || 0,
          };

          if (turn.role === 'student') {
            const consecutiveStudentTurns = [turn];
            let j = i + 1;
            while (j < conversationHistory.length && conversationHistory[j].role === 'student') {
              consecutiveStudentTurns.push(conversationHistory[j]);
              j++;
            }

            const evaluation = evaluationResults.get(i);

            for (let k = 0; k < consecutiveStudentTurns.length; k++) {
              const currentTurn = conversationHistory[i + k];
              const isLastInGroup = k === consecutiveStudentTurns.length - 1;

              const turnTranscript = {
                role: currentTurn.role,
                content: currentTurn.content,
                timestamp: currentTurn.timestamp || new Date(),
                audioId: currentTurn.audioId || null,
                duration: currentTurn.duration || 0,
                speakSpeed: currentTurn.speakSpeed || 0,
              };

              if (isLastInGroup && evaluation) {
                turnTranscript.evaluation = evaluation;
              }

              updatedTranscripts.push(turnTranscript);
            }

            i += consecutiveStudentTurns.length;
          } else {
            updatedTranscripts.push(transcript);
            i++;
          }
        }

        return updatedTranscripts;
      } catch (error) {
        this.logger.error('Lỗi khi đánh giá các câu nói của học viên:', error);

        return conversationHistory.map(turn => ({
          role: turn.role,
          content: turn.content,
          timestamp: turn.timestamp || new Date(),
          audioId: turn.audioId || null,
          duration: turn.duration || 0,
          speakSpeed: turn.speakSpeed || 0,
        }));
      }
    },

    async evaluateStudentTurn(turnContent, turnIndex, conversationHistory, persona, course, session, consecutiveTurnCount = 1, enableStyleAnalysis = false, simulationFormatAnalysis = 'dialogue') {
      try {
        const contextBefore = conversationHistory.slice(Math.max(0, turnIndex - 10), turnIndex);

        const formattedContextBefore = contextBefore
          .map(msg => `[${msg.role === 'student' ? 'Học viên' : 'AI'}]: ${msg.content}`)
          .join('\n');

        let skillsInfo = '';
        if (session && session.scenarioSkillIds && session.scenarioSkillIds.length > 0) {
          skillsInfo = '\n# CÁC KỸ NĂNG ĐÁNH GIÁ:\n';
          session.scenarioSkillIds.forEach((scenarioSkill, index) => {
            const skill = scenarioSkill.skillId;
            if (skill) {
              skillsInfo += `${index + 1}. ${skill.name || 'Không có tên'}\n`;
              if (skill.instruction) {
                skillsInfo += `   Hướng dẫn: ${skill.instruction}\n`;
              }
            }
          });
        }

        let referencesInfo = '';
        if (course && course.references && course.references.length > 0) {
          referencesInfo = '\n# TÀI LIỆU THAM KHẢO:\n';
          const referencesContent = course.references
            .map(reference => {
              if (reference && !reference.isDeleted) {
                let refInfo = `## ${reference.name || 'Tài liệu không tên'}\n`;
                if (reference.content) {
                  refInfo += `${reference.content}\n`;
                }
                return refInfo;
              }
              return null;
            })
            .filter(Boolean);
          referencesInfo += referencesContent.join('\n---\n');
        }

        let scenarioInfo = '';
        if (session && session.aiScenarioId) {
          scenarioInfo = '\n# THÔNG TIN KỊCH BẢN:\n';
          if (session.aiScenarioId.aiDescription) {
            scenarioInfo += `## Mô tả cho AI Persona:\n${session.aiScenarioId.aiDescription}\n`;
          }
          if (session.aiScenarioId.studentDescription) {
            scenarioInfo += `## Mô tả cho Học viên:\n${session.aiScenarioId.studentDescription}\n`;
          }
        }

        let turnEvaluationInstruction;
        if (simulationFormatAnalysis === 'dialogue') {
          turnEvaluationInstruction = enableStyleAnalysis ? TURN_EVALUATION_INSTRUCTION : TURN_EVALUATION_INSTRUCTION_NO_STYLE;
        } else if (simulationFormatAnalysis === 'knowledge_test') {
          turnEvaluationInstruction = TURN_EVALUATION_INSTRUCTION_KNOWLEDGE_TEST;
        }

        const evaluationPrompt = `${turnEvaluationInstruction}

# THÔNG TIN BỐI CẢNH:
- AI Persona: ${persona?.name || 'Không có thông tin'} (${persona?.role || ''})
- Khóa học: ${course?.name || 'Không có thông tin'}
${scenarioInfo}
${skillsInfo}
${referencesInfo}

# NGỮ CẢNH CUỘC TRÒ CHUYỆN:
${formattedContextBefore ? `## Trước đó:\n${formattedContextBefore}\n` : ''}

## Câu nói của học viên cần đánh giá (lượt ${turnIndex + 1}):
[Học viên]: ${turnContent}`;

        let modelData;
        if (persona.llmModelId) {
          modelData = await this.broker.call('llmsmodel.getDetailsModel', { id: persona.llmModelId });
        } else {
          modelData = await this.broker.call('llmsmodel.getDefaultModel');
        }

        const { apiKey, model, endpoint } = modelData;
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const MAX_RETRIES = 2;
        let parsedEvaluation = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const evaluationResponse = await this.broker.call(
              modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
              {
                messages: [
                  { role: 'system', content: evaluationPrompt },
                  {
                    role: 'user',
                    content: 'Hãy đánh giá câu nói của học viên và trả về kết quả theo định dạng JSON yêu cầu.',
                  },
                ],
                temperature: 0.3,
                max_tokens: 1000,
                apiKey,
                model,
                endpoint,
              },
            );

            // Parse JSON response
            const jsonStartIndex = evaluationResponse.indexOf('{');
            const jsonEndIndex = evaluationResponse.lastIndexOf('}') + 1;

            if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
              let jsonString = evaluationResponse.substring(jsonStartIndex, jsonEndIndex);
              try {
                parsedEvaluation = JSON.parse(jsonString);
              } catch (parseErr) {
                jsonString = jsonString.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');
                jsonString = jsonString.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
                jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
                jsonString = jsonString.replace(/:\s*'([^']*)'/g, ':"$1"');
                parsedEvaluation = JSON.parse(jsonString);
              }
              break;
            } else {
              throw new Error("Không tìm thấy JSON trong phản hồi.");
            }
          } catch (err) {
            this.logger.warn(`Lỗi đánh giá turn ${turnIndex} lần ${attempt}: ${err.message}`);
            if (attempt === MAX_RETRIES) {
              this.logger.warn(`Thất bại hoàn toàn khi đánh giá turn ${turnIndex} sau ${MAX_RETRIES} lần thử`);
              return null;
            }
          }
        }

        if (parsedEvaluation) {
          return {
            feedback: parsedEvaluation.feedback || '',
            suggestions: Array.isArray(parsedEvaluation.suggestions) ? parsedEvaluation.suggestions : [],
            examples: Array.isArray(parsedEvaluation.examples) ? parsedEvaluation.examples : [],
            isCorrect: parsedEvaluation.isCorrect || false,
            correctAnswer: parsedEvaluation.correctAnswer || '',
            result: parsedEvaluation.result || '',
            type: parsedEvaluation.type || 'soft_skill',
          };
        } else {
          return null;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi đánh giá turn ${turnIndex}:`, error);
        return null; // Không crash app
      }
    },

    formatDuration(startTime, endTime) {
      if (!startTime) return 'Không có thông tin';

      const start = new Date(startTime);
      let end = endTime ? new Date(endTime) : new Date();

      // Tính thời lượng (ms)
      const duration = end - start;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);

      return `${minutes} phút ${seconds} giây`;
    },
  },

  created() { },

  async started() { },

  async stopped() { },
};
