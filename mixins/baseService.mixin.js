'use strict';

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('moleculer-db').MoleculerDB} MoleculerDB  Moleculer's DB Service Schema
 */
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
module.exports = {
  /**
   * Action Hooks
   */
  hooks: {
    before: {
      /**
       * Register a before hook for the `create` action.
       * It sets a default value for the quantity field.
       *
       * @param {Context} ctx
       */
      create(ctx) {
        ctx.params.creatorId = ctx.meta?.userID?.toString();
        // ctx.params.quantity = 0;
      },
      update(ctx) {
        ctx.params.editorId = ctx.meta?.userID?.toString();
        // ctx.params.quantity = 0;
      },
      find(ctx) {
        // ctx.params.quantity = 0;
        ctx.params.populate = ctx.params.populate || this.settings.populateOptions;
        ctx.params.query = {...ctx.params.query};
      },
      list(ctx) {
        ctx.params.populate = ctx.params.populate || this.settings.populateOptions;

        let query = {};
        if (typeof ctx.params.query === 'string') {
          try {
            query = JSON.parse(ctx.params.query);
          } catch (e) {
            // Handle invalid JSON gracefully if needed
          }
        } else {
          query = ctx.params.query || {};
        }

        if (query.isDeleted === undefined) {
          query.isDeleted = false;
        }
        ctx.params.query = query;
        ctx.params.pageSize = Number(ctx.params.pageSize) || Number(ctx.params.limit) || 10;

        if (ctx.params.searchFields) {
          ctx.params.query = this.convertSearchFields(ctx.params.searchFields, ctx.params.query);
        }
      },
    },
    after: {
      find(ctx, res) {
        // ctx.params.quantity = 0;
        return res;
      },

      async create(ctx, res) {
        const data = await this.adapter.findById(res._id);
        return await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, data);
      },
      async update(ctx, res) {
        const data = await this.adapter.findById(res._id);
        return await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, data);
      },
    },
    error: {
      '*': function (ctx, err) {
        console.log('ERROR HOOK++++++', err);
        throw err
      },
    },
  },
  /**
   * Events
   */
  events: {},

  /**
   * Actions
   */
  actions: {
    getAllWithoutPagination: {
      rest: 'GET /findAll',
      auth: 'required',
      /** @param {Context} ctx */

      async handler(ctx) {
        const {query, populate, searchFields, sort} = ctx.params;
        let parsedQuery = {};
        if (typeof query === 'string') {
          try {
            parsedQuery = JSON.parse(query);
          } catch (e) {
            parsedQuery = {};
          }
        } else {
          parsedQuery = query || {};
        }
        const updatedQuery = {...parsedQuery, isDeleted: {$ne: true}};

        const finalQuery = searchFields ? this.convertSearchFields(searchFields, updatedQuery) : updatedQuery;
        const finalPopulate = populate || this.settings.populateOptions;
        ctx.params = {
          query: finalQuery,
          populate: finalPopulate,
          sort,
        };
        return await ctx.call(`${this.name}.find`, ctx.params);
      },
    },
    updateMany: {
      rest: {
        method: 'PUT',
        path: '/updateMany',
      },
      async handler(ctx) {
        const {query, update} = ctx.params;
        return await this.adapter.updateMany(query, update);
      },
    },
    deleteMany: {
      rest: 'DELETE /deleteMany',
      auth: 'required',
      async handler(ctx) {
        const {query} = ctx.params;
        const parsedQuery = typeof query === 'string' ? JSON.parse(query) : query || {};

        return await this.adapter.updateMany({_id: {$in: parsedQuery.ids}}, {isDeleted: true});
      },
    },

    getListNoPermission: {
      rest: 'GET /no-permission/list',
      auth: 'required',
      async handler(ctx) {
        const params = this.sanitizeParams(ctx, ctx.params);
        params.offset = params.page ? (params.page - 1) * params.pageSize : 0;
        params.query = {...params.query, isDeleted: {$ne: true}};
        return this._list(ctx, params);
      },
    },

    getAllWithoutPaginationNoPermission: {
      rest: 'GET /no-permission/all',
      auth: 'required',
      async handler(ctx) {
        const params = this.sanitizeParams(ctx, ctx.params);
        params.pageSize = undefined;
        params.page = undefined;
        params.query = {...params.query, isDeleted: {$ne: true}};
        const result = await this._find(ctx, params);
        return Array.isArray(result) ? result : result.rows || [];
      },
    },
  },

  /**
   * Methods
   */
  methods: {
    formatRegexString(str) {
      if (typeof str !== 'string') {
        str = str?.toString() || '';
      }
      // Escape all special regex characters
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },
    convertSearchFields(searchFields, query) {
      const fieldsArray = searchFields.split(',');
      for (let item of fieldsArray) {
        query[item] = new RegExp(this.formatRegexString(query[item]), 'i');
      }
      return query;
    },
  },

  /**
   * Service created lifecycle event handler
   */
  created() {},

  /**
   * Service started lifecycle event handler
   */
  async started() {},

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {},
};
