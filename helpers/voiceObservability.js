'use strict';

function buildVoiceTimerKey(phase, sessionId, turnId) {
  return `voice:${phase}:${sessionId || 'unknown'}:${turnId || 'na'}`;
}

function ensureState(state) {
  if (!state.__voiceObservability) {
    state.__voiceObservability = {
      activeTimers: new Set(),
      timerStartedAt: {},
      interrupt: {
        attempted: 0,
        succeeded: 0,
      },
    };
  }
  return state.__voiceObservability;
}

function startVoiceTimer({ state, phase, sessionId, turnId }) {
  if (!state) return null;
  const obs = ensureState(state);
  const key = buildVoiceTimerKey(phase, sessionId, turnId);
  if (obs.activeTimers.has(key)) return key;

  obs.activeTimers.add(key);
  obs.timerStartedAt[key] = Date.now();
  console.time(key);
  return key;
}

function endVoiceTimer({ state, phase, sessionId, turnId }) {
  if (!state) return null;
  const obs = ensureState(state);
  const key = buildVoiceTimerKey(phase, sessionId, turnId);

  if (!obs.activeTimers.has(key)) {
    return null;
  }

  obs.activeTimers.delete(key);
  const startedAt = obs.timerStartedAt[key];
  delete obs.timerStartedAt[key];

  console.timeEnd(key);
  if (!startedAt) return null;
  return Date.now() - startedAt;
}

function recordVoiceMetric(logger, { metricName, value, sessionId, turnId, unit = 'ms', extra = {} }) {
  if (!logger) return;
  logger.warn('[voice.metric]', {
    metricName,
    value,
    unit,
    sessionId,
    turnId,
    ...extra,
  });
}

function logFlagDecision(logger, { flagName, flagValue, sessionId, turnId }) {
  if (!logger) return;
  logger.warn('[voice.flag.decision]', {
    flagName,
    flagValue,
    sessionId,
    turnId,
  });
}

function markInterruptAttempt(state) {
  if (!state) return;
  const obs = ensureState(state);
  obs.interrupt.attempted += 1;
}

function markInterruptSuccess(state) {
  if (!state) return;
  const obs = ensureState(state);
  obs.interrupt.succeeded += 1;
}

function getInterruptStats(state) {
  const obs = ensureState(state || {});
  const attempted = obs.interrupt.attempted;
  const succeeded = obs.interrupt.succeeded;
  return {
    attempted,
    succeeded,
    successRate: attempted > 0 ? succeeded / attempted : 0,
  };
}

module.exports = {
  buildVoiceTimerKey,
  startVoiceTimer,
  endVoiceTimer,
  recordVoiceMetric,
  logFlagDecision,
  markInterruptAttempt,
  markInterruptSuccess,
  getInterruptStats,
};
