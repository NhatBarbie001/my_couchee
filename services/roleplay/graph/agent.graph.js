'use strict';

const {StateGraph, START, END} = require('@langchain/langgraph');
const VoiceAgentGraphState = require('./state');
const {createLLMNode} = require('./nodes/llm.node');

function createVoiceAgentGraph({broker, logger}) {
  const llmNode = createLLMNode({broker, logger});

  const graphBuilder = new StateGraph(VoiceAgentGraphState)
    .addNode('llm', llmNode)
    .addEdge(START, 'llm')
    .addEdge('llm', END);

  return graphBuilder.compile();
}

module.exports = {
  createVoiceAgentGraph,
};
