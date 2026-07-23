'use strict';

const {Annotation} = require('@langchain/langgraph');

const VoiceAgentGraphState = Annotation.Root({
  sessionId: Annotation(),
  transcript: Annotation(),
  history: Annotation(),
  turnId: Annotation(),
  runId: Annotation(),
  meta: Annotation(),
  response: Annotation(),
  updatedHistory: Annotation(),
  sentencesDispatched: Annotation(),
  aiInitiatedEnd: Annotation(),
  provider: Annotation(),
});

module.exports = VoiceAgentGraphState;
