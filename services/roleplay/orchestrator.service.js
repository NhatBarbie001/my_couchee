'use strict';

const {isFlagEnabled} = require('../../helpers/featureFlag');
const {createVoiceAgentGraph} = require('./graph/agent.graph');

module.exports = {
  name: 'roleplay.orchestrator',

  created() {
    this.runningJobs = new Map();
    this.graph = createVoiceAgentGraph({
      broker: this.broker,
      logger: this.logger,
    });
  },

  actions: {
    isRunActive: {
      params: {
        sessionId: {type: 'string'},
        runId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, runId = null} = ctx.params;
        const activeJob = this.runningJobs.get(sessionId);

        if (!activeJob) {
          return {active: false, reason: 'no_active_job'};
        }

        if (runId && activeJob.runId !== runId) {
          return {active: false, reason: 'run_mismatch'};
        }

        if (activeJob.controller.signal.aborted) {
          return {active: false, reason: 'aborted'};
        }

        return {active: true, runId: activeJob.runId};
      },
    },

    run: {
      params: {
        sessionId: {type: 'string'},
        transcript: {type: 'string', optional: true},
        source: {type: 'string', optional: true},
        turnId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, transcript = '', source = 'runtime', turnId = null} = ctx.params;
        const llmV2Enabled = isFlagEnabled('VOICE_LLM_V2_ENABLED', true);

        const currentJob = this.runningJobs.get(sessionId);
        if (currentJob && !currentJob.controller.signal.aborted) {
          currentJob.controller.abort('superseded_by_new_run');
          this.runningJobs.delete(sessionId);
          await this.broker
            .call('roleplaysessions.interruptSessionRuntime', {
              sessionId,
              reason: 'superseded_by_new_run',
              runId: currentJob.runId,
            })
            .catch(() => {});
        }

        const controller = new AbortController();
        const runId = `orch_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.runningJobs.set(sessionId, {
          controller,
          runId,
          startedAt: Date.now(),
          turnId,
          source,
        });

        try {
          if (controller.signal.aborted) {
            return {
              success: false,
              cancelled: true,
              runId,
            };
          }

          let result;

          if (llmV2Enabled) {
            const runtimePayload = await this.broker.call('roleplaysessions.getLLMRuntimePayload', {
              sessionId,
              runId,
              transcript,
              source,
              turnId,
            });

            if (runtimePayload && runtimePayload.skipped) {
              result = {success: false, skipped: true, reason: runtimePayload.reason || 'payload_skipped'};
            } else {
              const graphResult = await this.graph.invoke(
                {
                  ...runtimePayload,
                  runId,
                },
                {
                  signal: controller.signal,
                },
              );

              const llmResult = {
                response: graphResult?.response,
                updatedHistory: graphResult?.updatedHistory,
                sentencesDispatched: graphResult?.sentencesDispatched,
                aiInitiatedEnd: graphResult?.aiInitiatedEnd,
                provider: graphResult?.provider,
              };

              await this.broker.call('roleplaysessions.completeLLMRuntimeTurn', {
                ...runtimePayload,
                sessionId,
                runId,
                turnId: runtimePayload.turnId || turnId,
                response: llmResult.response,
                updatedHistory: llmResult.updatedHistory,
                sentencesDispatched: llmResult.sentencesDispatched,
                aiInitiatedEnd: !!llmResult.aiInitiatedEnd,
              });

              result = {
                success: true,
                llmV2: true,
                graphV2: true,
                llmResult,
              };
            }
          } else {
            result = await this.broker.call('roleplaysessions.executeOrchestratedTurn', {
              sessionId,
              runId,
              transcript,
              source,
              turnId,
            });
          }

          if (controller.signal.aborted) {
            return {
              success: false,
              cancelled: true,
              runId,
            };
          }

          return {
            success: true,
            runId,
            result,
          };
        } catch (error) {
          if (controller.signal.aborted) {
            return {
              success: false,
              cancelled: true,
              runId,
              message: 'run_cancelled',
            };
          }

          // Fix P2: Surface lỗi về client để session không bị treo im lặng
          this.logger.error('[roleplay.orchestrator] run.failed', {
            sessionId,
            runId,
            turnId,
            error: error?.message,
            code: error?.code || error?.type,
          });

          await this.broker
            .call('roleplaysessions.completeLLMRuntimeTurn', {
              sessionId,
              runId,
              turnId,
              response: '',
              updatedHistory: [],
              sentencesDispatched: 0,
              aiInitiatedEnd: false,
              _errorCleanup: true,
            })
            .catch(() => {});

          throw error;
        } finally {
          const activeJob = this.runningJobs.get(sessionId);
          if (activeJob && activeJob.runId === runId) {
            this.runningJobs.delete(sessionId);
          }
        }
      },
    },

    cancel: {
      params: {
        sessionId: {type: 'string'},
        reason: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {sessionId, reason = 'interrupt'} = ctx.params;
        const activeJob = this.runningJobs.get(sessionId);

        if (!activeJob) {
          await this.broker
            .call('roleplaysessions.interruptSessionRuntime', {
              sessionId,
              reason,
              noActiveJob: true,
            })
            .catch(() => {});

          return {
            cancelled: false,
            reason: 'no_active_job',
          };
        }

        if (!activeJob.controller.signal.aborted) {
          activeJob.controller.abort(reason);
        }
        this.runningJobs.delete(sessionId);

        await this.broker.call('roleplaysessions.interruptSessionRuntime', {
          sessionId,
          reason,
          runId: activeJob.runId,
        });

        return {
          cancelled: true,
          runId: activeJob.runId,
          reason,
        };
      },
    },
  },
};