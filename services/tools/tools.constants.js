module.exports.TOOL_IDS = {
  CREATE_TEXT_ON_TOPIC: "createTextOnTopic",

  TRANSCRIPT_YOUTUBE: "transcriptYoutube",
  CREATE_SUMMARY_OPTIONS: "createSummaryOptions",
  CREATE_QUESTIONS_FOR_VIDEO: "createQuestionsForVideo",
  CREATE_OPEN_QUESTIONS_FOR_VIDEO: "createOpenQuestionsForVideo",
  CREATE_WARM_DISCUSSION_QUESTIONS_FOR_VIDEO: "createWarmDiscussionQuestionsForVideo",

  CREATE_THREE_TITLES_FOR_TEXT: "createThreeTitlesForText",
  CREATE_OPEN_QUESTIONS_FOR_TEXT: "createOpenQuestionsForText",
  CREATE_ABCD_QUESTIONS_FOR_TEXT: "createABCDQuestionsForText",
  CREATE_TRUE_FALSE_QUESTIONS_FOR_TEXT: "createTrueFalseQuestionsForText",
  CREATE_FILL_IN_QUESTIONS_FOR_TEXT: "createABCDQuestionsFillInBlankForText",
  CREATE_WARM_DISCUSSION_QUESTIONS_FOR_TEXT: "createWarmDiscussionQuestionsForText",

  AUDIO_TO_TEXT: "transcriptAudio",
  CREATE_QUESTIONS_FOR_AUDIO: "createQuestionsForAudio",
  CREATE_OPEN_QUESTIONS_FOR_AUDIO: "createOpenQuestionsForAudio",
  CREATE_SUMMARY_OPTIONS_FOR_AUDIO: "createSummaryOptionsForAudio",
  CREATE_WARM_DISCUSSION_QUESTIONS_FOR_AUDIO: "createWarmDiscussionQuestionsForAudio",

  CREATE_ABCD_QUESTIONS_FOR_FILE: "createABCDQuestionsForFile",

  CREATE_PICTURE_DESCRIPTION: "createPictureDescription",
  CREATE_CONVERSATION_ABOUT_PICTURE: "createConversationAboutPicture",


  WRITING_TASK_WITH_TARGET: "writingTaskWithTarget",
  LIST_ESSAY_TOPICS: "listEssayTopics",
  FOUR_OPINIONS_ABOUT_TOPIC: "fourOpinionsAboutTopic",
  FIND_QUOTES_ABOUT_TOPIC: "findQuotesAboutTopic",
  ADVANTAGES_AND_DISADVANTAGES: "advantagesAndDisadvantages",
  FIND_FACT_ABOUT_TOPIC: "findFactAboutTopic",
  CREATE_DISCUSSION_QUESTIONS_FOR_TOPIC: "createDiscussionQuestionsForTopic",
  SCRAMBLE_WORDS_IN_SENTENCES: "scrambleWordsInSentences",
  CREATE_WORD_TRANSLATION_MATCHING: "createWordTranslationMatching",
  EXTRACT_COLLOCATIONS_FROM_TEXT: "extractCollocationsFromText",
  CREATE_ESSENTIAL_VOCABULARY: "createEssentialVocabulary",
  CREATE_COMMUNICATIVE_SITUATIONS: "createCommunicativeSituations",
  CREATE_SENTENCES_FROM_WORDS: "createSentencesFromWords",
  CREATE_FILL_IN_GAPS_OF_TEXT: "createFillInGapsOfText",
  CREATE_READING_BITS_AND_PIECES: "createReadingBitsAndPieces",
  CREATE_LEAD_IN_ACTIVITY_IDEAS: "createLeadInActivityIdeas",
  CREATE_CONVERSATION_ABOUT_TEXT: "createConversationAboutText",

};

module.exports.TOOL_WELCOME = {
  YOUTUBE: {
    inputType: 'video',
    description: 'Create a lecture from Youtube videos'
  },
  DOCUMENT: {
    inputType: 'text',
    description: 'Create a lesson from existing documents'
  },
  IMAGE: {
    inputType: 'image',
    description: 'Create a lecture with images'
  },
  AUDIO: {
    inputType: 'audio',
    description: 'Create a lecture using audio files'
  },
};
