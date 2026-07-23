class SimpleCache {
  constructor(ttlMs = 300000) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  set(key, value) {
    const expiresAt = Date.now() + this.ttl;
    this.cache.set(key, {value, expiresAt});
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

module.exports = {
  name: 'cache',

  created() {
    this.personaCache = new SimpleCache(600000);
    this.courseCache = new SimpleCache(600000);
    this.scenarioCache = new SimpleCache(600000);
    this.llmModelCache = new SimpleCache(300000);
    this.apiKeyCache = new SimpleCache(300000);

    this.cleanupInterval = setInterval(() => {
      this.personaCache.cleanup();
      this.courseCache.cleanup();
      this.scenarioCache.cleanup();
      this.llmModelCache.cleanup();
      this.apiKeyCache.cleanup();
    }, 60000);

    this.logger.info('Cache mixin initialized with TTL-based caching');
  },

  stopped() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  },

  methods: {

    async getCachedPersona(personaId) {
      const cacheKey = `persona:${personaId}`;
      let persona = this.personaCache.get(cacheKey);

      if (!persona) {
        this.logger.debug(`Persona cache miss: ${personaId}`);
        persona = await this.broker.call('aipersonas.get', {id: personaId});
        if (persona) {
          this.personaCache.set(cacheKey, persona);
        }
      } else {
        this.logger.debug(`Persona cache hit: ${personaId}`);
      }

      return persona;
    },


    async getCachedCourse(courseId, populate = []) {
      const populateKey = JSON.stringify(populate);
      const cacheKey = `course:${courseId}:${populateKey}`;
      let course = this.courseCache.get(cacheKey);

      if (!course) {
        this.logger.debug(`Course cache miss: ${courseId}`);
        course = await this.broker.call('courses.get', {
          id: courseId,
          populate,
        });
        if (course) {
          this.courseCache.set(cacheKey, course);
        }
      } else {
        this.logger.debug(`Course cache hit: ${courseId}`);
      }

      return course;
    },
    async getCachedScenario(scenarioId) {
      const cacheKey = `scenario:${scenarioId}`;
      let scenario = this.scenarioCache.get(cacheKey);

      if (!scenario) {
        this.logger.debug(`Scenario cache miss: ${scenarioId}`);
        scenario = await this.broker.call('aiscenarios.get', {id: scenarioId});
        if (scenario) {
          this.scenarioCache.set(cacheKey, scenario);
        }
      } else {
        this.logger.debug(`Scenario cache hit: ${scenarioId}`);
      }

      return scenario;
    },

    async getCachedLLMModel(modelId) {
      const cacheKey = `llmModel:${modelId}`;
      let model = this.llmModelCache.get(cacheKey);

      if (!model) {
        this.logger.debug(`LLM model cache miss: ${modelId}`);
        model = await this.broker.call('llmsmodel.get', {id: modelId});
        if (model) {
          this.llmModelCache.set(cacheKey, model);
        }
      } else {
        this.logger.debug(`LLM model cache hit: ${modelId}`);
      }

      return model;
    },

    async getCachedApiKey(query) {
      const cacheKey = `apiKey:${JSON.stringify(query)}`;
      let apiKey = this.apiKeyCache.get(cacheKey);

      if (!apiKey) {
        this.logger.debug(`API key cache miss`);
        apiKey = await this.broker.call('apikeys.getOne', query);
        if (apiKey) {
          this.apiKeyCache.set(cacheKey, apiKey);
        }
      } else {
        this.logger.debug(`API key cache hit`);
      }

      return apiKey;
    },

    getCacheStats() {
      return {
        persona: this.personaCache.size(),
        course: this.courseCache.size(),
        scenario: this.scenarioCache.size(),
        llmModel: this.llmModelCache.size(),
        apiKey: this.apiKeyCache.size(),
      };
    },

    clearAllCaches() {
      this.personaCache.clear();
      this.courseCache.clear();
      this.scenarioCache.clear();
      this.llmModelCache.clear();
      this.apiKeyCache.clear();
      this.logger.info('All caches cleared');
    },
  },

  actions: {

    getCacheStats: {
      visibility: 'public',
      handler(ctx) {
        return this.getCacheStats();
      },
    },

    clearCaches: {
      visibility: 'public',
      handler(ctx) {
        this.clearAllCaches();
        return {success: true, message: 'All caches cleared'};
      },
    },
  },
};
