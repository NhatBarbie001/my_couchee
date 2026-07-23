'use strict';

const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const {TOOL_WELCOME} = require('./tools.constants');
const {getConfig} = require('../../config/config');
const i18next = require('i18next');
const {INPUT_TYPE, OUTPUT_TYPE} = require('../../constants/constant');
const config = getConfig(process.env.NODE_ENV);
const {ObjectId} = require('mongoose').Types;
const {MoleculerClientError} = require('moleculer').Errors;
const AuthRole = require('../../mixins/authRole.mixin');
const {USER_CODES} = require('../../constants/constant');

/**
 *
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: 'tools',
  mixins: [FunctionsCommon] /**
   * Settings
   */,
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {
      instructionIds: {
        action: 'instructions.get',
        params: {
          fields: 'shortName outputType _id showAdditionalRequest outputTypeId optionIds',
        },
      },
      groupToolIds: 'toolgroups.get',
    },
    // fields: [
    //   "instructionIds", "isDeleted", "isFavorite", "inputType", "showOnWelcome", "isOrganizationTool",
    //   "toolId", "categories", "name", "description", "shortName", "_id", "contentTitle", "visible"
    // ],
    populateOptions: ['instructionIds.outputTypeId', 'instructionIds.optionIds', 'groupToolIds'],
  },

  /**
   * Dependencies
   */
  dependencies: [],

  /**
   * Actions
   */
  actions: {
    submit: {
      rest: {
        method: 'POST',
        path: '/submit',
      },
      params: {
        input: {type: 'object', required: true},
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {inputData, inputType} = ctx.params.input;
        const {response} = ctx.params;

        const instructionData = await this.broker.call('instructions.details', {
          id: inputData.instructionId,
          populateOpts: ['optionIds.knowledgeIds', 'outputTypeId'],
        });
        // Processing input data
        const inputText = await this.processInput(inputData, inputType, response._id);
        const emptyInput = this.handleResponseWithoutInputText(inputText, inputType, inputData);

        if (emptyInput) return emptyInput;

        if (!instructionData) {
          return await this.handleResponseWithoutInstruction(ctx, inputType, inputText, inputData);
        }

        const {
          apiKey,
          modelInterface,
          maxTokens,
          url: endpoint,
        } = await this.broker.call('llmsmodel.getOneByModel', {gptModel: instructionData.gptModel});
        const modelMaxToken =
          !instructionData?.maxTokens && !maxTokens
            ? undefined
            : Math.min(instructionData?.maxTokens || Infinity, maxTokens || Infinity);

        async function findRelatedKnowlegdes(instruction, optionsKnowledges) {
          return await ctx.call('knowledge.findRelatedKnowlegdes', {instruction, optionsKnowledges});
        }

        // Creating completion options based on instructionData
        const completionOptions = await completionOptionCreator(instructionData, findRelatedKnowlegdes)(
          inputText,
          inputData,
          inputType,
        );
        // Generating completionParams for further processing
        const completionParams = this.makeCompletionParams(response, inputData, instructionData, completionOptions);
        const responseFormat = instructionData.outputTypeId?.responseFormat || instructionData.responseFormat;
        // Calling chatCompletion service to get AI result
        const serviceName = this.getServiceName(modelInterface);

        const aiResult = await this.broker.call(`${serviceName}.chatCompletion`, {
          ...completionParams,
          responseFormat,
          responseId: response._id,
          temperature: instructionData.temperature,
          apiKey,
          modelInterface,
          max_tokens: modelMaxToken,
          endpoint,
        });
        // Initializing the result object
        const outputType = instructionData.outputTypeId?.code || instructionData.outputType;
        const result = {
          success: aiResult !== undefined && aiResult !== null,
          outputType,
          output: this.convertOutput(responseFormat, aiResult, outputType, inputText, inputData),
        };

        if (
          instructionData?.outputTypeId?.responseFormat === 'json_object' &&
          outputType !== OUTPUT_TYPE.PRON_FEEDBACK
        ) {
          const schema = instructionData.outputTypeId?.schemaInstruction || instructionData.schemaInstruction;
          const isDataValid = this.checkValidSchema(schema, result.output);
          if (!isDataValid) return new Error();
        }
        const convertJsonToPlaintext = json => JSON.stringify(json, null, 2);

        if (result.output.json && !result.output.text) {
          result.output.text = convertJsonToPlaintext(result.output.json);
        }

        result.plaintext = this.getPlaintext(result.outputType, result.output);

        result.responseHeadline = instructionData.responseHeadline || instructionData.shortName;

        result.lastMessages = this.lastMessagesCreator(inputData, response, aiResult, completionOptions);
        // result.output.inputText = inputText
        return result || new Error();
      },
    },

    splitInput: {
      params: {
        input: {type: 'object', required: true},
      },
      auth: 'required',
      async handler(ctx) {
        const {inputData, inputType} = ctx.params.input;

        const instructionData = await this.broker.call('instructions.details', {
          id: inputData.splitInstructionId,
          populateOpts: ['optionIds.knowledgeIds', 'outputTypeId'],
        });

        // Processing input data
        const inputText = await this.processInput(inputData, inputType);
        const emptyInput = this.handleResponseWithoutInputText(inputText, inputType, inputData);
        if (emptyInput) return emptyInput;

        if (!instructionData) {
          return await this.handleResponseWithoutInstruction(ctx, inputType, inputText, inputData);
        }

        const gptModelData = await this.broker.call('llmsmodel.findOne', {gptModel: instructionData.gptModel});

        const apiKey = gptModelData?.apiKeyId?.apiKey;
        const modelInterface = gptModelData?.apiKeyId?.modelInterface;
        const maxTokens =
          !instructionData?.maxTokens && !gptModelData?.maxTokens
            ? undefined
            : Math.min(instructionData?.maxTokens || Infinity, gptModelData?.maxTokens || Infinity);
        const endpoint = gptModelData?.apiKeyId?.url;

        async function findRelatedKnowlegdes(instruction, optionsKnowledges) {
          return await ctx.call('knowledge.findRelatedKnowlegdes', {instruction, optionsKnowledges});
        }

        // Creating completion options based on instructionData
        const completionOptions = await completionOptionCreator(
          instructionData,
          apiKey,
          modelInterface,
          findRelatedKnowlegdes,
        )(inputText, inputData);
        // Generating completionParams for further processing
        const completionParams = this.makeCompletionParams({}, inputData, instructionData, completionOptions);
        const responseFormat = instructionData.outputTypeId?.responseFormat || instructionData.responseFormat;
        // Calling chatCompletion service to get AI result
        const serviceName = modelInterface && modelInterface !== 'ChatOpenAI' ? 'langchain' : 'chatgpt';
        const aiResult = await this.broker.call(`${serviceName}.chatCompletion`, {
          ...completionParams,
          responseFormat,
          temperature: instructionData.temperature,
          max_tokens: maxTokens,
          apiKey,
          endpoint,
        });
        // Initializing the result object
        const result = {
          success: aiResult !== undefined && aiResult !== null,
          outputType: instructionData?.outputTypeId?.code || instructionData.outputType,
          output: {},
        };
        switch (responseFormat) {
          case 'text':
            result.output.text = aiResult;
            break;
          case 'markdown':
            result.output.markdown = aiResult;
            result.output.text = aiResult;
            break;
          case 'json_object':
            result.output = aiResult;
            break;
        }

        // Validating data schema if responseFormat is json_object
        if (instructionData?.outputTypeId?.responseFormat === 'json_object') {
          const schema = instructionData.outputTypeId?.schemaInstruction || instructionData.schemaInstruction;
          const isDataValid = this.checkValidSchema(schema, result.output);
          if (!isDataValid) return new Error(isDataValid);
        }

        return result || new Error();
      },
    },

    submitMultiSections: {
      params: {
        input: {type: 'object', required: true},
      },
      auth: 'required',

      async handler(ctx) {
        const {inputData, inputType} = ctx.params.input;
        const {response} = ctx.params;

        const instructionData = await this.broker.call('instructions.details', {
          id: inputData.instructionId,
          populateOpts: ['optionIds.knowledgeIds', 'outputTypeId', 'subInstructionIds.outputTypeId'],
        });

        const inputText = await this.processInput(inputData, inputType, response._id);

        const emptyInput = this.handleResponseWithoutInputText(inputText, inputType, inputData);
        if (emptyInput) return emptyInput;

        const {
          apiKey,
          modelInterface,
          maxTokens,
          url: endpoint,
        } = await this.broker.call('llmsmodel.getOneByModel', {
          gptModel: instructionData.gptModel,
        });
        const gptModels = await Promise.all(
          instructionData.subInstructionIds.map(instruction =>
            this.broker.call('llmsmodel.getOneByModel', {
              gptModel: instruction.gptModel,
              instructionId: instruction._id,
            }),
          ),
        );
        const mapGptModels = this.convertObject(gptModels, 'instructionId');

        const modelMaxToken = Math.min(instructionData?.maxTokens || Infinity, maxTokens || Infinity);

        const submitParent = await this.handleSubmit(
          instructionData,
          inputText,
          inputData,
          inputType,
          apiKey,
          modelInterface,
          modelMaxToken,
          response,
          endpoint,
        );
        if (submitParent.state !== 'valid')
          return {
            success: true,
            outputType: OUTPUT_TYPE.HTML,
            output: {
              ...submitParent,
              inputText,
            },
            plaintext: '',
            responseHeadline: instructionData.responseHeadline || instructionData.shortName,
          };
        const results = await Promise.all(
          instructionData.subInstructionIds.map(instruction =>
            this.handleSubmit(
              {
                ...instruction,
                options: instructionData.options,
              },
              inputText,
              inputData,
              inputType,
              mapGptModels[instruction._id]?.apiKey,
              mapGptModels[instruction._id]?.modelInterface,
              modelMaxToken,
              response,
            ),
          ),
        );

        return this.handleOutputMultiSection(results, instructionData, inputText, inputData, inputType);
      },
    },

    groupTool: {
      rest: {
        method: 'GET',
        path: '/groupTool',
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const favoriteTools = await ctx.call('tools.find', {query: {isFavorite: true}});
        return favoriteTools.reduce((acc, item) => {
          const categoryArray = item.categories?.split(',');
          if (!categoryArray) return acc;
          categoryArray.forEach(category => {
            const trimmedCategory = category.trim();
            acc[trimmedCategory] = acc[trimmedCategory] || [];
            acc[trimmedCategory].push(item);
          });
          return acc;
        }, {});
      },
    },

    plaintextFromTool: {
      rest: {
        method: 'GET',
        path: '/plaintextFromTool',
      },
      params: {
        outputType: 'string',
        output: 'object',
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {outputType, output} = ctx.params;

        switch (outputType) {
          case OUTPUT_TYPE.HTML:
            return this.convertHTMLToText(this.htmlWithoutImage(output?.html));
          case OUTPUT_TYPE.HTML_QUESTIONS:
            return this.convertHTMLToText(this.htmlWithoutImage(output?.questionsHtml));
          default:
            return this.getPlaintext(outputType, output);
        }
      },
    },

    findOneByToolId: {
      rest: {
        method: 'GET',
        path: '/:toolId/findOne',
      },
      params: {
        toolId: 'string',
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {toolId} = ctx.params;
        const tool = await this.adapter.findOne({toolId});
        return this.transformDocuments(ctx, {populate: ['instructionIds.optionIds']}, tool);
      },
    },

    detailTools: {
      rest: {
        method: 'GET',
        path: '/instruction',
      },
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const [instructions, tools] = await Promise.all([
          ctx.call('instructions.find', {query: {isDeleted: false}}),
          ctx.call('tools.find', {
            query: {visible: 'public', isDeleted: false},
            populate: ['toolId.instructionIds'],
          }),
        ]);

        const instructionIds = instructions.map(instruction => instruction._id);

        return tools.map(tool => {
          const filteredInstructions = tool.instructionIds
            .filter(instruction => instructionIds.includes(instruction._id))
            .map(instruction => ({
              ...instruction,
              options: instruction.optionIds || [],
            }));

          return {
            ...tool,
            instructionIds: filteredInstructions,
          };
        });
      },
    },

    // Get welcome tools
    welcome: {
      rest: {
        method: 'GET',
        path: '/welcome',
      },
      auth: 'required',
      async handler(ctx) {
        const {user} = ctx.meta;
        const [persona, tools] = await Promise.all([
          ctx.call('persona.find', {
            query: {code: {$in: user.persona}},
            fields: ['toolId'],
          }),
          ctx.call('tools.detailTools'),
        ]);
        const toolIds = persona
          .map(p => p.toolId)
          .flat()
          .map(t => t._id);
        const filteredTools = tools.filter(tool => toolIds.includes(tool._id) && tool.visible === 'public');
        const toolMaps =
          filteredTools.length > 0 ? this.groupBy(filteredTools, 'inputType') : this.groupBy(tools, 'inputType');
        for (const value of Object.values(TOOL_WELCOME)) {
          let selectedTools = [];
          if (value.inputType === 'text') {
            selectedTools = [...(toolMaps['text'] || []), ...(toolMaps['topic'] || [])];
          } else if (value.inputType === 'video') {
            const offlineVideos = toolMaps['offline_video'] || [];
            const onlineVideos = toolMaps['video'] || [];
            selectedTools = [...offlineVideos, ...onlineVideos];
          } else {
            selectedTools = toolMaps[value.inputType] || [];
          }
          value.tools = selectedTools.slice(0, 2);
        }
        return TOOL_WELCOME;
      },
    },

    availableTools: {
      rest: {
        method: 'GET',
        path: '/availableTools',
      },
      auth: 'required',
      async handler(ctx) {
        const queryTools = {
          isDeleted: false,
          visible: {$in: ['public', 'developing']},
          groupToolIds: {$exists: true},
        };
        return this.getDetailTools(ctx, queryTools);
      },
    },

    examTools: {
      rest: {
        method: 'GET',
        path: '/examTools',
      },
      auth: 'required',
      async handler(ctx) {
        const queryTools = {
          isDeleted: false,
          visible: {$in: ['public', 'developing']},
          groupToolIds: {$exists: true},
          type: {$in: ['EXAM_SCHOOL', 'EXAM_IELTS']},
        };
        return this.getDetailTools(ctx, queryTools, false);
      },
    },

    markTestTools: {
      rest: {
        method: 'GET',
        path: '/markTestTools',
      },
      auth: 'required',
      async handler(ctx) {
        const queryTools = {
          isDeleted: false,
          visible: {$in: ['public', 'developing']},
          groupToolIds: {$exists: true},
          type: {$in: ['MARK_TEST_SCHOOL', 'MARK_TEST_IELTS']},
        };
        return this.getDetailTools(ctx, queryTools, true);
      },
    },

    allTools: {
      rest: {
        method: 'GET',
        path: '/allTools',
      },
      auth: 'required',
      async handler(ctx) {
        return this.getDetailTools(ctx);
      },
    },

    favorite: {
      rest: {
        method: 'POST',
        path: '/favorite',
      },
      async handler(ctx) {
        const {toolId} = ctx.params;
        const userId = ctx.meta.user?._id;

        const [userTool] = await ctx.call('userTools.find', {query: {userId, toolId}});

        if (userTool) {
          return ctx.call('userTools.update', {id: userTool._id, isFavorite: true});
        }

        return ctx.call('userTools.insert', {entity: {userId, toolId, isFavorite: true}});
      },
    },

    unFavorite: {
      rest: {
        method: 'DELETE',
        path: '/:toolId/favorite',
      },

      async handler(ctx) {
        const {toolId} = ctx.params;
        const userId = ctx.meta.user?._id;
        const userTool = await ctx.call('userTools.find', {query: {userId, toolId}});

        const mcallActions = userTool.map(tool => {
          return ctx.call('userTools.remove', {id: tool?._id});
        });
        return await Promise.all(mcallActions);
      },
    },

    copy: {
      rest: {
        method: 'POST',
        path: '/copy',
      },
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {toolId} = ctx.params;

        const tool = await this.adapter.findById(toolId);

        if (!tool) {
          throw new Error(`Tool not found to copy`);
        }

        const newToolObj = {
          ...tool.toObject(),
          name: `${tool.name} - Copy`,
          visible: 'developing',
          _id: undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
          isDeleted: false,
        };

        return await this.adapter.insert(newToolObj);
      },
    },
    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const tool = await this.adapter.findOne({_id: id});
        await this.adapter.updateById(id, {isDeleted: true}, {new: true});
        return tool;
      },
    },

    getToolByMostUsed: {
      rest: 'GET /getToolByMostUsed',
      auth: 'required',
      async handler(ctx) {
        const {user} = ctx.meta;

        const query = ctx.params.query ? JSON.parse(ctx.params.query) : {};
        const type = (query.type || 'NORMAL').toUpperCase();

        const queryTools = {
          isDeleted: false,
          visible: 'public',
          ...(type.includes('NORMAL') ? {$or: [{type: {$exists: false}}, {type}]} : {type}),
          groupToolIds: {$exists: true},
        };

        const [listUserUsedTools, publicTools, userFavoriteTools] = await Promise.all([
          ctx.call('inputs.statisticInputTracking', {query: {userId: ObjectId(user._id)}}),
          ctx.call('tools.find', {query: queryTools, populate: []}),
          ctx.call('userTools.find', {query: {userId: ObjectId(user._id), isFavorite: true}, populate: []}),
        ]);
        const favoriteToolsMap = userFavoriteTools.reduce((map, item) => {
          map[item.toolId] = item;
          return map;
        }, {});

        // Filter userUsedTools by type and organization access
        let userUsedTools =
          listUserUsedTools?.[0]?.toolUsed
            ?.map(item => item.tool)
            .filter(
              tool =>
                (type.includes('NORMAL') ? !tool.type || type.includes(tool.type) : type.includes(tool.type)) &&
                (tool.visible === 'private'
                  ? tool.organizationIds.map(String)?.includes(user?.organizationId?.toString())
                  : true),
            ) || [];

        const orgTools = user?.organizationId
          ? await ctx.call('tools.find', {
              query: {
                type: queryTools.type,
                organizationIds: user?.organizationId,
                isDeleted: false,
              },
              populate: [],
            })
          : [];

        const listTools = [...publicTools, ...orgTools];

        const usedToolIds = new Set(userUsedTools.map(tool => tool._id.toString()));

        for (const tool of listTools) {
          if (!usedToolIds.has(tool._id.toString())) {
            usedToolIds.add(tool._id.toString());
            userUsedTools.push(tool);
          }
        }

        return userUsedTools.map(tool => ({
          ...tool,
          isFavorite: !!favoriteToolsMap[tool._id],
        }));
      },
    },

    checkToolPermission: {
      async handler(ctx) {
        const {id} = ctx.params;
        const {user} = ctx.meta;
        const tool = await this.adapter.findById(id);
        if (!tool) {
          throw new MoleculerClientError(i18next.t('error_tool_not_found'), 404);
        }

        if (tool.organizationIds.length > 0 && user?.organizationId) {
          if (!tool.organizationIds.map(String).includes(user?.organizationId?.toString())) {
            throw new MoleculerClientError(i18next.t('dont_have_permission_tool'), 403);
          }

          const organization = await ctx.call('organizations.getOne', {id: user?.organizationId});

          if (organization?.active === false) {
            throw new MoleculerClientError(i18next.t('organization_already_locked'), 423);
          }
        }

        return tool;
      },
    },
    submitFastLLM: {
      async handler(ctx) {
        try {
          const {messages, schema, temperature = 1, max_tokens = 200, responseFormat, responseId} = ctx.params;
          // Lấy default model data để có apiKey và modelInterface
          const defaultModelData = await ctx.call('llmsmodel.getDefaultModel');
          const apiKey = defaultModelData?.apiKey;
          const endpoint = defaultModelData?.endpoint;
          const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';
          const model = defaultModelData?.gptModel || 'gpt-4.1-mini';
          const result = await this.broker.call(
            modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
            {
              messages,
              model,
              temperature,
              max_tokens,
              apiKey,
              responseFormat,
              schema,
              responseId,
              endpoint,
            },
          );
          return result;
        } catch (error) {
          console.error('Error in handler:', error);
        }
      },
    },
    submitSlowLLM: {
      async handler(ctx) {
        try {
          const {messages, schema, responseId} = ctx.params;
          const gptModelData = await ctx.call('llmsmodel.findOne', {gptModel: 'gpt-4o'});
          const apiKey = gptModelData?.apiKeyId?.apiKey;
          const modelInterface = gptModelData?.apiKeyId?.modelInterface;
          const result = await this.broker.call(
            modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
            {
              messages,
              model: 'gpt-4o-mini',
              temperature: 1,
              max_tokens: 200,
              apiKey,
              responseFormat: 'json_object',
              schema,
              responseId,
            },
          );
          return result.topic;
        } catch (error) {
          console.error('Error in handler:', error.message);
        }
      },
    },
    create: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    update: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    list: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    get: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    getAllWithoutPagination: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    updateMany: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
    deleteMany: {
      handler(ctx) {
        console.log(ctx.params);
      },
    },
  },

  /**
   * Events
   */
  events: {},

  /**
   * Methods
   */
  methods: {
    async handleSubmit(
      instructionData,
      inputText,
      inputData,
      inputType,
      apiKey,
      modelInterface,
      modelMaxToken,
      response,
      endpoint,
    ) {
      const serviceName = this.getServiceName(modelInterface);
      const completionOptions = await completionOptionCreator(instructionData, [], serviceName)(
        inputText,
        inputData,
        inputType,
      );

      const completionParams = this.makeCompletionParams(response, inputData, instructionData, completionOptions);
      const responseFormat = instructionData.outputTypeId?.responseFormat || instructionData.responseFormat;

      return this.broker.call(`${serviceName}.chatCompletion`, {
        ...completionParams,
        responseFormat,
        responseId: response._id,
        temperature: instructionData.temperature,
        apiKey,
        modelInterface,
        max_tokens: modelMaxToken,
        endpoint,
      });
    },

    convertOutput(responseFormat, aiResult, outputType, inputText, inputData) {
      try {
        let output = {};
        const convertMarkdown = markdown => {
          const html = this.convertMarkDownToHTML(markdown);
          const text = this.convertHTMLToText(html) || markdown;
          return {html, text};
        };
        switch (responseFormat) {
          case 'text':
            output.text = aiResult;
            break;
          case 'markdown':
            const {html, text} = convertMarkdown(aiResult);
            output.markdown = aiResult;
            output.html = html;
            output.text = text;
            break;
          case 'json_object':
            output = aiResult;
            if (outputType === OUTPUT_TYPE.HTML_QUESTIONS) {
              const questions = convertMarkdown(output.questions);
              output.questionsHtml = questions.html;
              output.questionsText = questions.text;

              if (output.correctAnswers) {
                const answers = convertMarkdown(output.correctAnswers);
                output.answersHtml = answers.html;
                output.answersText = answers.text;
              }
            }

            if (outputType === OUTPUT_TYPE.MARK_TEST_WRITING) {
              const evaluation = convertMarkdown(output?.evaluation);
              const answers = convertMarkdown(inputText);
              output.evaluation = inputText
                ? `<h2>Answers</h2><p>${answers.html}</p><br>${evaluation.html}`
                : evaluation.html;
            }
            if (outputType === OUTPUT_TYPE.MARK_TEST_IELTS_WRITING) {
              const evaluation = convertMarkdown(output?.evaluation);
              const answers = convertMarkdown(inputText);
              output.evaluation = inputText
                ? `<h2>Answers</h2><p>${answers.html}</p><br>${evaluation.html}`
                : evaluation.html;
            }
            if (outputType === OUTPUT_TYPE.PRON_FEEDBACK) {
              const markdown = output.evaluations
                .map(section => `## ${section.sectionName}\n\n${section.feedback}\n\n`)
                .join('');

              const {html} = convertMarkdown(markdown);
              output.html = html.replace(/<table[^>]*>[\s\S]*?<\/table>/g, table => {
                return table
                  .replace(/<th>/g, '<th style="border: 1px solid black;"><b>')
                  .replace(/<\/th>/g, '<\/b><\/th>')
                  .replace(/<td>/g, '<td style="border: 1px solid black;">');
              });

              output.evaluations.forEach(section => {
                section.feedback = this.convertMarkDownToHTML(section.feedback);
              });
            }
            break;
        }

        if (outputType === OUTPUT_TYPE.PRON_FEEDBACK) {
          output = {...inputData, ...output};
        }

        return output;
      } catch (e) {
        console.log(e);
        return aiResult;
      }
    },

    handleResponseWithoutInputText(inputText, inputType) {
      const typesRequiringNoInputText = new Set([
        INPUT_TYPE.MARK_TEST,
        INPUT_TYPE.MARK_TEST_IMAGE,
        INPUT_TYPE.MARK_TEST_TASK_1,
        INPUT_TYPE.MARK_TEST_TASK_2,
        INPUT_TYPE.STUDENT_TASK_1,
        INPUT_TYPE.STUDENT_TASK_2,
      ]);

      if (!inputText) {
        if (!typesRequiringNoInputText.has(inputType) && inputType !== INPUT_TYPE.NONE) {
          return this.responseObject(inputText, inputType);
        }

        return {
          success: true,
          outputType: OUTPUT_TYPE.MARK_TEST_WRITING,
          output: {
            evaluation: i18next.t('cannot_evaluate_without_content'),
            score: 0,
          },
        };
      }
    },

    async handleResponseWithoutInstruction(ctx, inputType, inputText, inputData) {
      if (inputType === INPUT_TYPE.TTS) {
        const {voice, speed} = inputData;
        const audio = await ctx.call('audios.textToSpeech', {text: inputText, voice, speed});
        return {
          success: true,
          outputType: OUTPUT_TYPE.AUDIO,
          output: {
            audio,
          },
          completionTokens: 0,
          gptModel: 'tts-1',
          promptTokens: inputText.length,
          totalTokens: inputText.length,
        };
      }
      return this.responseObject(inputText);
    },

    htmlWithoutImage(html) {
      return html.replace(/<figure[^>]*>.*?<\/figure>/g, '<figure></figure>');
    },

    makeCompletionParams(response, inputData, instructionData, completionOptions) {
      const {additionalRequest, isExamProject} = inputData;
      if (!response.lastMessages || !additionalRequest || isExamProject) return completionOptions;
      return {
        ...completionOptions,
        messages: [...response.lastMessages, {role: 'user', content: additionalRequest}],
      };
    },

    lastMessagesCreator(inputData, response, aiResult, completionOptions) {
      const {additionalRequest, isExamProject} = inputData;
      if (!!response.lastMessages && additionalRequest && !isExamProject) {
        return [
          ...response.lastMessages,
          {role: 'user', content: additionalRequest},
          {
            role: 'assistant',
            content: JSON.stringify(aiResult),
          },
        ];
      }
      return [...completionOptions.messages, {role: 'assistant', content: JSON.stringify(aiResult)}];
    },

    async processInput(inputData, inputType, responseId) {
      try {
        switch (inputType) {
          case INPUT_TYPE.TEXT:
          case INPUT_TYPE.HTML:
            return inputData?.text;
          case INPUT_TYPE.HTML_TRIM_NBSP:
            return inputData?.text?.replace(/&nbsp;/g, '');
          case INPUT_TYPE.VIDEO:
            if (inputData.videoType === 'offline') {
              return await this.processOfflineVideoInputTranscript(inputData, inputType);
            }
            return await this.processVideoInputTranscript(inputData, inputType);
          case INPUT_TYPE.OFFLINE_VIDEO:
            return await this.processOfflineVideoInputTranscript(inputData, inputType);
          case INPUT_TYPE.TOPIC:
            return inputData.topic;
          case INPUT_TYPE.AUDIO:
            return await this.processAudioInputTranscript(inputData, inputType);
          case INPUT_TYPE.IMAGE:
            return await this.processImageInputTranscript(inputData, inputType, responseId);
          case INPUT_TYPE.FILE:
            return await this.processFileInputTranscript(inputData, inputType);
          case INPUT_TYPE.MARK_TEST:
          case INPUT_TYPE.MARK_TEST_TASK_2:
          case INPUT_TYPE.STUDENT_TASK_2:
            return await this.processMarkTestInput(inputData, inputType);
          case INPUT_TYPE.MARK_TEST_IMAGE:
          case INPUT_TYPE.MARK_TEST_TASK_1:
          case INPUT_TYPE.STUDENT_TASK_1:
            return await this.processMarkTestInput(inputData, inputType);
          case INPUT_TYPE.AUDIO_STREAM:
          case INPUT_TYPE.STUDENT_SPEAKING:
            return await this.processSpeakingInput(inputData, inputType);
          default:
            return inputData.text;
        }
      } catch (e) {
        return null;
      }
    },

    async processVideoInputTranscript(inputData, inputType) {
      if (inputData.videoType !== 'youtube') {
        throw new Error('Video type invalid, video type is not youtube');
      }
      const {url, cutStart, cutEnd} = inputData;
      return this.broker.call('videos.videoTranscript', {
        url,
        cutStart,
        cutEnd,
      });
    },

    async processOfflineVideoInputTranscript(inputData, inputType) {
      if (inputData.videoType !== 'offline') {
        throw new Error('Video type invalid, video type is not offline');
      }
      const {offlineVideoId, cutStart, cutEnd} = inputData;

      return this.broker.call('offlinevideos.offlineVideoTranscript', {
        offlineVideoId,
        cutStart,
        cutEnd,
      });
    },

    async processAudioInputTranscript(inputData, inputType) {
      if (inputType !== INPUT_TYPE.AUDIO) {
        throw new Error('inputType invalid, inputType is not audio');
      }
      const {audioId, cutStart, cutEnd} = inputData;
      return this.broker.call('audios.audioTranscript', {
        audioId,
        cutStart,
        cutEnd,
      });
    },

    async processFileInputTranscript(inputData, inputType) {
      if (inputType !== INPUT_TYPE.FILE) {
        throw new Error('inputType invalid, inputType is not file');
      }
      const {fileId, startPage: firstPage, endPage: lastPage, totalPages} = inputData;
      const response = await this.broker.call('files.extractTextFromFileId', {
        id: fileId,
        firstPage,
        lastPage,
        totalPages,
      });
      return response.text;
    },

    async processImageInputTranscript(inputData, inputType, responseId) {
      if (inputType !== INPUT_TYPE.IMAGE) {
        throw new Error('inputType invalid, inputType is not audio');
      }
      const {imageId, topicImageId} = inputData;
      return this.broker.call('images.describeImage', {
        imageId: topicImageId || imageId,
        responseId,
      });
    },

    async processMarkTestInput(inputData, inputType) {
      const validMarkTestTypes = new Set([
        INPUT_TYPE.MARK_TEST,
        INPUT_TYPE.MARK_TEST_IMAGE,
        INPUT_TYPE.MARK_TEST_TASK_1,
        INPUT_TYPE.MARK_TEST_TASK_2,
        INPUT_TYPE.STUDENT_TASK_1,
        INPUT_TYPE.STUDENT_TASK_2,
      ]);

      if (!validMarkTestTypes.has(inputType)) {
        throw new Error('inputType invalid, inputType is not a valid mark_test type');
      }
      const isMarkTestImage = [
        INPUT_TYPE.MARK_TEST_IMAGE,
        INPUT_TYPE.MARK_TEST_TASK_1,
        INPUT_TYPE.STUDENT_TASK_1,
      ].includes(inputType);

      if (isMarkTestImage) {
        const [topicImage, topicImageBase64] = await Promise.all([
          this.broker.call('images.get', {id: inputData.topicImageId.toString()}),
          this.broker.call('images.getBase64', {imageId: inputData.topicImageId.toString()}),
        ]);
        inputData.topicImageUrl = `${config.domain}/api/files/link/${topicImage.imageFileId}/image.png`;
        inputData.topicImageBase64 = topicImageBase64;
      }

      const {imageId, fileId, text, imageIds} = inputData;
      if (!imageId && !fileId && !text && !imageIds) {
        return null;
      }
      const {markTestType} = inputData;
      if (markTestType === INPUT_TYPE.TEXT) return inputData.text;
      if (markTestType === INPUT_TYPE.FILE) return this.processFileInputTranscript(inputData, markTestType);
      if (markTestType === INPUT_TYPE.IMAGE) return this.processMarkTestImage(inputData, inputType);
    },

    async processMarkTestImage(inputData) {
      // handle topic image
      if (inputData.imageId || inputData.topicImageId) {
        const [image, imageBase64] = await Promise.all([
          this.broker.call('images.get', {id: inputData.imageId || inputData.topicImageId}),
          this.broker.call('images.getBase64', {imageId: inputData.imageId || inputData.topicImageId}),
        ]);
        inputData.imageUrl = `${config.domain}/api/files/link/${image.imageFileId}/image.png`;
        inputData.imageBase64 = imageBase64;
      }
      // handle essay image
      if (inputData.imageIds) {
        const textPromises = inputData.imageIds.map(imageId => [
          this.broker.call('images.textFromImageId', {imageId: imageId}),
        ]);
        const imagetext = await Promise.all(textPromises.flat());
        return imagetext.join('\n\n');
      }
    },

    async processSpeakingInput(inputData) {
      function listWordByErrorType(results) {
        return results
          .flatMap(item => item['NBest'][0].Words || [])
          .reduce((map, item) => {
            const {
              Word: word,
              PronunciationAssessment: {
                ErrorType: errorType,
                Feedback: {Prosody: {Break: {ErrorTypes: errorTypes = []} = {}} = {}} = {},
              },
            } = item;
            if (errorType && errorType !== 'None') {
              map[errorType] = map[errorType] || [];
              map[errorType].push(word);
            }
            errorTypes.forEach(type => {
              if (type !== 'None') {
                map[type] = map[type] || [];
                map[type].push(word);
              }
            });
            return map;
          }, {});
      }

      function getDurationRecordAudio(results) {
        const lastWord = results.flatMap(item => item['NBest'][0].Words || []).pop();

        return lastWord ? (lastWord.Offset + lastWord.Duration) / 10 ** 7 : 0;
      }

      function getWPM(recognizedText, duration) {
        const words = recognizedText.split(/\s+/).filter(word => word.length > 0);
        const totalWords = words.length;

        const wpm = +totalWords / (duration / 60);
        return +wpm.toFixed(2);
      }

      function checkMonotone(results) {
        return results
          .flatMap(item => item['NBest'][0].Words || [])
          .some(word => word.PronunciationAssessment?.Feedback?.Prosody?.Intonation?.ErrorTypes?.includes('Monotone'));
      }

      const duration = getDurationRecordAudio(inputData.results);
      const wpm = getWPM(inputData.recognizedText, duration);
      const errorsList = listWordByErrorType(inputData.results);
      const isMonotone = checkMonotone(inputData.results);

      inputData.contentScore = (inputData.vocabularyScore + inputData.grammarScore + inputData.topicScore) / 3;
      return `Input data:
      - Accuracy: ${inputData.accuracyScore || inputData.overallPronunciationScore.accuracyScore},
      - Fluency: ${inputData.fluencyScore},
      - Vocabulary: ${inputData.vocabularyScore},
      - Grammar: ${inputData.grammarScore},
      - Errors: ${JSON.stringify(errorsList)}
      - Transcript: ${inputData.recognizedText}
      - Audio Data: Duration: ${duration}s, Rate of speech: ${wpm} wpm, Monotony: ${isMonotone}`;
    },

    getPlaintext(outputType, output) {
      const outputMap = {
        html_questions: this.htmlQuestionsOutput,
        mark_test_writing: this.markTestWritingOutput,
        mark_test_ielts_writing: this.markTestWritingOutput,
        options: this.optionsOutput,
        open_question: this.questionOutput,
        tf_question: this.trueFalseQuestionOutput,
        multi_choice: this.questionOutput,

        fill_gaps: this.fillGapsOutput,
        dialogues: this.dialoguesOutput,
        matching_words: this.matchingOutput,
        words: this.wordsOutput,
        scramble_words: this.scrambleQuestions,
        writing_task: this.writingTaskOutput,
        advantages_and_disadvantages: this.advantagesDisadvantagesOutput,
        essay_topics: this.essayTopicsOutput,
      };

      return (outputMap[outputType] || (output => output.text) || (output => output))(output);
    },

    writingTaskOutput(output) {
      return `Writing tasks:\n${this.onlyOptionsOutput(output)}`;
    },

    textOutput(output) {
      return output.text;
    },

    essayTopicsOutput(output) {
      const {personalEssayTopics, generalEssayTopics} = output;

      const {firstListFormatted, secondListFormatted} = this.twoListOutput(personalEssayTopics, generalEssayTopics);

      return `Personal essay topics:\n${firstListFormatted}\nGeneral essay topics:\n${secondListFormatted}`;
    },

    dialoguesOutput(output) {
      const {dialogues} = output;
      return dialogues?.map(dialogue => `A. ${dialogue.personA}\nB. ${dialogue.personB}`).join('\n');
    },

    matchingOutput(output) {
      const {inputWords, translations, correctMatches} = output;

      const english = inputWords
        ? inputWords
            .sort((a, b) => a.wordId - b.wordId)
            .map((pair, index) => `\t${index + 1}. ${pair.word}`)
            .join('\n')
        : '';

      const translated = translations
        ? translations.map(pair => `\t${pair.translationId}. ${pair.translation}`).join('\n')
        : '';

      const matches = correctMatches
        ? correctMatches.map(match => `${match.wordId}. ${match.translationId}`).join('\t')
        : '';
      return `Words:\n${english}\n\nTranslation:\n${translated}\n\nCorrect matches:\n${matches}`;
    },

    trueFalseQuestionOutput(output) {
      const {questions, correctAnswers} = output;
      const formattedQuestions = this.formatQuestions(questions);
      const trueFalseAnswers = this.generateTrueFalseAnswers(correctAnswers);
      return `${this.lineBreak(formattedQuestions)}${trueFalseAnswers}`;
    },

    questionOutput(output) {
      const {questions, options, correctAnswers} = output;
      const formattedQuestions = questions ? this.formatQuestions(questions) : this.onlyOptionsOutput(output);
      const formattedAnswers = correctAnswers ? this.formatAnswers(correctAnswers) : '';
      return `${formattedQuestions}\n${formattedAnswers}`;
    },

    optionsOutput(output) {
      const {correctOptionId} = output;
      let questions = this.onlyOptionsOutput(output);
      return `${questions}\n${correctOptionId ? `Correct answers: ${correctOptionId}` : ''}`;
    },
    htmlQuestionsOutput(output) {
      const {questionsText, answersText} = output;
      return `${questionsText}\n${answersText ? `Correct answers: ${answersText}` : ''}`;
    },
    markTestWritingOutput(output) {
      const {evaluation} = output;
      return this.convertHTMLToText(evaluation);
    },

    advantagesDisadvantagesOutput(output) {
      const {advantages, disadvantages} = output;

      const {firstListFormatted, secondListFormatted} = this.twoListOutput(advantages, disadvantages);

      return `Advantages:\n${firstListFormatted}\nDisadvantages:\n${secondListFormatted}`;
    },

    fillGapsOutput(output) {
      const {text, correctAnswers} = output;
      const formattedAnswers = this.formatAnswers(correctAnswers);
      return `${text}\n\n${formattedAnswers}`;
    },

    twoListOutput(firstList, secondList) {
      const firstListFormatted = firstList ? firstList.map(first => `${first.itemId}. ${first.text}`).join('\n') : '';

      const secondListFormatted = secondList
        ? secondList.map(second => `${second.itemId}. ${second.text}`).join('\n')
        : '';
      return {firstListFormatted, secondListFormatted};
    },

    onlyOptionsOutput(output) {
      const {options} = output;

      return options
        ? options
            .map(({optionId, text, author}, index) => {
              return `${index + 1}. ${text}\n${author ? `-- ${author}\n` : ''}`;
            })
            .join('')
        : '';
    },

    wordsOutput(output) {
      const {words} = output;
      return words?.map(word => `${word}\n`).join('');
    },

    generateTrueFalseAnswers(correctAnswers) {
      let answers = 'Correct answers:\n';
      correctAnswers?.forEach(({correctAnswer, questionId, answerExplain}, index) => {
        answers += `${index + 1}. ${correctAnswer}${correctAnswer.toLowerCase() === 'false' ? ` -- ${answerExplain}` : ''}\n`;
      });
      return answers;
    },

    formatQuestions(questionsList) {
      let stringQuestions = 'Questions:';
      questionsList?.forEach(({question, questionId, options}) => {
        stringQuestions += `\n${questionId}. ${question}`;
        options?.forEach(({optionId, text}) => {
          stringQuestions += `\n${optionId}. ${text}`;
        });
      });
      return stringQuestions;
    },

    scrambleQuestions(output) {
      const {questions, correctAnswers} = output;
      const formattedQuestions =
        questions
          ?.map(({question, questionId}, index) => {
            const questionText = question.join(' / ');
            return `${index + 1}. ${questionText}`;
          })
          .join('\n') + '\n';
      const formattedAnswers = this.formatAnswers(correctAnswers);
      return formattedQuestions + formattedAnswers;
    },

    formatAnswers(answersList) {
      const answers = answersList
        ?.map(({correctAnswer, questionId}, index) => {
          return `${index + 1}. ${correctAnswer}`;
        })
        .join('\n');
      return answers ? `Correct answers:\n${answers}` : '';
    },

    async getDetailTools(ctx, queryTools = {}, isNormal = true) {
      const {user} = ctx.meta;
      const [instructions, publicTools, userFavoriteTools] = await Promise.all([
        ctx.call('instructions.find', {query: {isDeleted: false}}),
        ctx.call('tools.find', {
          query: queryTools,
          populate: ['instructionIds.optionIds', 'instructionIds.outputTypeId', 'groupToolIds'],
          sort: '-visible',
        }),
        ctx.call('userTools.find', {
          query: {userId: user._id, isFavorite: true},
          populate: [],
        }),
      ]);
      let orgTools = [];

      if (user.organizationId && isNormal) {
        orgTools = await ctx.call('tools.find', {
          query: {
            ...(queryTools?.type && {type: queryTools.type}),
            organizationIds: user.organizationId,
            isDeleted: false,
          },
          populate: ['instructionIds.optionIds', 'instructionIds.outputTypeId', 'organizationIds', 'groupToolIds'],
          sort: '-visible',
        });
      }
      const tools = [...publicTools, ...orgTools].sort((a, b) => b.visible.localeCompare(a.visible));
      const favoriteToolsMap = userFavoriteTools.reduce((map, item) => {
        map[item.toolId] = item;
        return map;
      }, {});

      const instructionIds = new Set(instructions.map(instruction => instruction._id));

      const sampleContents = await ctx.call('samplecontents.find', {
        query: {isDeleted: false},
        populate: [],
      });
      const mapContent = sampleContents.reduce((map, item) => {
        map[item.toolId] = item._id;
        return map;
      }, {});

      return tools.map(tool => {
        const filteredInstructions = tool.instructionIds
          .filter(instruction => instructionIds.has(instruction._id))
          .map(instruction => ({
            outputTypeId: instruction.outputTypeId,
            shortName: instruction.shortName,
            showAdditionalRequest: instruction.showAdditionalRequest,
            _id: instruction._id,
            options: instruction.optionIds || [],
          }));

        return {
          ...tool,
          instructionIds: filteredInstructions,
          isFavorite: !!favoriteToolsMap[tool._id],
          existGuide: !!mapContent[tool._id],
        };
      });
    },

    getNoInputText(inputType) {
      const messages = {
        text: i18next.t('no_input_text'),
        topic: i18next.t('no_input_text'),
        image: i18next.t('image_no_text'),
        audio: i18next.t('audio_no_text'),
        video: i18next.t('video_no_text'),
        offline_video: i18next.t('video_no_text'),
        file: i18next.t('file_no_text'),
        mark_test: {
          evaluation: i18next.t('cannot_evaluate_without_content'),
          score: 0,
        },
        default: i18next.t('no_input_text'),
      };

      return messages[inputType] || messages.default;
    },

    responseObject(inputText, inputType) {
      const text = inputType ? this.getNoInputText(inputType) : inputText;
      return {
        success: true,
        outputType: OUTPUT_TYPE.TEXT,
        output: {text},
        plaintext: text,
      };
    },

    handleMarkTestTask1Output(instructionData, findResult, inputText, inputData) {
      const extractContent = key => {
        const item = findResult(item => item?.[key]);
        return item ? (typeof item[key] === 'string' ? this.convertMarkDownToHTML(item[key] || ' ') : item[key]) : null;
      };
      const improvedEssayData = findResult(item => !!item.improvedEssay);
      const output = {
        suggests: extractContent('suggests'),
        sampleEssay: extractContent('sampleEssay'),
        vocabularies: extractContent('vocabularies'),
        essayAssessment: extractContent('essayAssessment') || findResult(item => item.introduction && item.overview),
        evaluations: extractContent('evaluations'),
        overallBandScore: extractContent('overallBandScore'),
        grammarStructureSuggestion: extractContent('grammarStructureSuggestion'),
        improvedEssay: improvedEssayData?.improvedEssay,
        category: findResult(item => item?.category)?.category ?? null,
      };

      const outputType = instructionData.outputTypeId?.code || instructionData.outputType;
      return {
        success: true,
        outputType,
        output: {
          ...output,
          inputText,
          topicImageBase64: inputData?.topicImageBase64 || '',
        },
        plaintext: '',
        responseHeadline: instructionData.responseHeadline || instructionData.shortName,
      };
    },

    handleMarkTestTask2Output(instructionData, findResult, inputText, inputData) {
      const extractContent = key => {
        const item = findResult(item => item?.[key]);
        return item ? (typeof item[key] === 'string' ? this.convertMarkDownToHTML(item[key] || ' ') : item[key]) : null;
      };
      const improvedEssayData = findResult(item => !!item.improvedEssay);
      const output = {
        suggests: extractContent('suggests'),
        sampleEssay: extractContent('sampleEssay'),
        vocabularies: extractContent('vocabularies'),
        arguments: extractContent('arguments'),
        criteria: extractContent('criteria'),
        overallBandScore: extractContent('overallBandScore'),
        improvedEssay: improvedEssayData?.improvedEssay,
        ideas: extractContent('ideas'),
        grammarStructureSuggestion: extractContent('grammarStructureSuggestion'),
        tag: findResult(item => item?.tag)?.tag ?? null,
        category: findResult(item => item?.category)?.category ?? null,
      };

      const outputType = instructionData.outputTypeId?.code || instructionData.outputType;

      return {
        success: true,
        outputType,
        output: {
          ...output,
          inputText,
          topicImageBase64: inputData?.topicImageBase64 || '',
        },
        plaintext: '',
        responseHeadline: instructionData.responseHeadline || instructionData.shortName,
      };
    },
    handleSpeakingOutput(instructionData, findResult, inputText, inputData) {
      const extractContent = key => {
        const item = findResult(item => item?.[key]);
        return item ? (typeof item[key] === 'string' ? this.convertMarkDownToHTML(item[key] || ' ') : item[key]) : null;
      };
      const output = {
        evaluations: extractContent('evaluations'),
        sentenceStructure: extractContent('sentenceStructure'),
        suggests: extractContent('suggests'),
        vocabularies: extractContent('vocabularies'),
        improvedEssay: extractContent('improvedEssay'),
        score: findResult(item => item?.score)?.score ?? null,
        tag: findResult(item => item?.tag)?.tag ?? null,
      };

      const markdown =
        `## Vocabulary and Grammar Improvement\n\n${output.suggests}\n\n` +
        `## Criteria Assessment\n\n${output.evaluations}\n\n` +
        `## Improved Version\n\n${output.improvedEssay}\n\n` +
        `## Vocabulary List\n\n${output.vocabularies}\n\n` +
        `## Sentence Structure\n\n${output.sentenceStructure}`;

      const html = this.convertMarkDownToHTML(markdown);
      output.html = html.replace(/<table[^>]*>[\s\S]*?<\/table>/g, table => {
        return table
          .replace(/<th>/g, '<th style="border: 1px solid black;"><b>')
          .replace(/<\/th>/g, '<\/b><\/th>')
          .replace(/<td>/g, '<td style="border: 1px solid black;">');
      });

      const outputType = instructionData.outputTypeId?.code || instructionData.outputType;

      return {
        success: true,
        outputType,
        output: {
          ...output,
          ...inputData,
        },
        plaintext: '',
        responseHeadline: instructionData.responseHeadline || instructionData.shortName,
      };
    },

    handleOutputMultiSection(results, instructionData, inputText, inputData, inputType, response) {
      const findResult = predicate => results.find(predicate);
      switch (inputType) {
        case INPUT_TYPE.MARK_TEST_TASK_1:
        case INPUT_TYPE.STUDENT_TASK_1:
          return this.handleMarkTestTask1Output(instructionData, findResult, inputText, inputData);
        case INPUT_TYPE.MARK_TEST_TASK_2:
        case INPUT_TYPE.STUDENT_TASK_2:
          return this.handleMarkTestTask2Output(instructionData, findResult, inputText, inputData);
        case INPUT_TYPE.AUDIO_STREAM:
        case INPUT_TYPE.STUDENT_SPEAKING:
          return this.handleSpeakingOutput(instructionData, findResult, inputText, inputData, response);
        default:
          return null;
      }
    },
    getServiceName(modelInterface = null) {
      const serviceMap = {
        ClaudeAI: 'claudeai',
        AzureOpenAI: 'azureopenai',
        AWSBedrock: 'awsbedrock',
        GoogleGenerativeAI: 'langchain',
        ChatOpenAI: 'chatgpt',
      };

      return serviceMap[modelInterface] || 'chatgpt';
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

  async afterConnected() {},
};
