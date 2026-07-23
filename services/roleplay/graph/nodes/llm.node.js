'use strict';

function createLLMNode({broker, logger}) {
  return async state => {
    const payload = {
      sessionId: state.sessionId,
      transcript: state.transcript || '',
      history: Array.isArray(state.history) ? state.history : [],
      turnId: state.turnId,
      runId: state.runId,
      meta: state.meta || {},
    };

    const llmResult = await broker.call('roleplay.llm.generate', payload);

    logger.info('[roleplay.graph] llm.node.completed', {
      sessionId: state.sessionId,
      turnId: state.turnId,
      runId: state.runId,
      sentencesDispatched: llmResult?.sentencesDispatched || 0,
      provider: llmResult?.provider,
    });

    return {
      response: llmResult?.response || '',
      updatedHistory: llmResult?.updatedHistory || payload.history,
      sentencesDispatched: llmResult?.sentencesDispatched || 0,
      aiInitiatedEnd: !!llmResult?.aiInitiatedEnd,
      provider: llmResult?.provider,
    };
  };
}

module.exports = {
  createLLMNode,
};
