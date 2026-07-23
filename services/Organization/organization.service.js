const DbMongoose = require('../../mixins/dbMongo.mixin');
const OrganizationModel = require('./organization.model');
const BaseService = require('../../mixins/baseService.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const { SERVICE_NAME } = require('./index');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const i18next = require('i18next');
const { IMAGE_SERVICE } = require('../Image');
const { SERVICE_NAME: ORGANIZATION_TYPE_SERVICE } = require('../OrganizationType');
const { USER_CODES } = require('../../constants/constant');
const { RESOURCES, ACTIONS } = require('../../constants/permissions');
const { ObjectId } = require('mongoose').Types;

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(OrganizationModel), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: 'organization',
    /** Validator schema for entity */
    entityValidator: {
      name: { type: 'string', min: 1 },
    },
    populates: {
      avatarId: 'images.get',
      organizationTypeId: `${ORGANIZATION_TYPE_SERVICE}.get`,
      parentOrganizationId: 'organizations.get',
    },
    populateOptions: ['avatarId', 'organizationTypeId', 'parentOrganizationId'],
  },
  hooks: {
    before: {
      // 'update|upload': 'checkPermission',
    },
    after: {
      find(ctx, res) {
        return res;
      },
    },
  },

  actions: {
    update: {
      rest: 'PUT /:id',
      auth: 'required',
      async handler(ctx) {
        try {
          const { id, ...data } = ctx.params;
          const updatePayload = { $set: {} };

          if (data.hasOwnProperty('parentOrganizationId') && data.parentOrganizationId) {
            if (data.parentOrganizationId.toString() === id.toString()) {
              throw new MoleculerClientError(i18next.t('error_parent_organization_cannot_be_self'),
                400,
                'INVALID_PARENT_ORGANIZATION');
            }
          }

          if (data.hasOwnProperty('parentOrganizationId')) {
            if (
              data.parentOrganizationId === null ||
              data.parentOrganizationId === undefined ||
              data.parentOrganizationId === ''
            ) {
              updatePayload.$unset = { parentOrganizationId: '' };
              delete data.parentOrganizationId;
            }
          }

          updatePayload.$set = data;
          return await this.adapter.updateById(id, updatePayload, { new: true });
        } catch (error) {
          throw new MoleculerClientError(
            error.message || i18next.t('error_update_organization'),
            error.code || 500,
            error.type || 'UPDATE_ORGANIZATION_ERROR',
            error.data,
          );
        }
      },
    },
    create: {
      rest: 'POST /',
      auth: 'required',
      params: {
        name: { type: 'string', min: 1 },
        // emailAdmin: {type: 'email'},
        organizationTypeId: { type: 'string' },
        parentOrganizationId: { type: 'string', optional: true, empty: true },
      },
      async handler(ctx) {
        try {
          const { name, organizationTypeId, parentOrganizationId } = ctx.params;

          // Kiểm tra organizationType có tồn tại không
          const orgType = await this.broker.call(`${ORGANIZATION_TYPE_SERVICE}.get`, { id: organizationTypeId });
          if (!orgType) {
            throw new MoleculerClientError(i18next.t('error_organization_type_not_found'), 404);
          }

          const dataToInsert = {
            name,
            organizationTypeId,
          };

          if (parentOrganizationId) {
            dataToInsert.parentOrganizationId = parentOrganizationId;
          }

          return await this.adapter.insert(dataToInsert);
        } catch (error) {
          if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || 'unknown';
            throw new MoleculerClientError(
              i18next.t('error_duplicate_field', { field }) || `Trường ${field} đã tồn tại`,
              409,
              'DUPLICATE_KEY_ERROR',
              { field, keyValue: error.keyValue },
            );
          }

          throw new MoleculerClientError(
            error.message || i18next.t('error_create_organization'),
            error.code || 500,
            error.type || 'CREATE_ORGANIZATION_ERROR',
            error.data,
          );
        }
      },
    },
    lock: {
      rest: 'POST /:id/lock',
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const { id } = ctx.params;
        const organization = await this.adapter.findById(id);
        if (!organization) {
          throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
        }

        if (organization?.active === false) {
          return await this.adapter.updateById(id, { active: true });
        } else {
          return await this.adapter.updateById(id, { active: false });
        }
      },
    },
    getTree: {
      rest: 'GET /manager',
      auth: 'required',
      async handler(ctx) {
        const { user } = ctx.meta;

        // Hàm đệ quy để thêm đường dẫn tên cha
        const addParentNamePath = (nodes, parentPath) => {
          nodes.forEach(node => {
            node.parentName = parentPath;
            const newPath = parentPath ? `${parentPath} - ${node.name}` : node.name;
            if (node.children && node.children.length > 0) addParentNamePath(node.children, newPath);
          });
        };

        // Hàm đệ quy để đánh dấu các node con của node đã bị xóa
        const markChildrenOfDeleted = (nodes, isParentDeleted = false) => {
          nodes.forEach(node => {
            node.isChildOfDeleted = isParentDeleted;
            if (node.children && node.children.length > 0) {
              markChildrenOfDeleted(node.children, isParentDeleted || node.isDeleted);
            }
          });
        };

        const { showDeleted } = ctx.params;

        const query = await this.applyUserPermissionToQuery(user);

        const allOrganizations = await this.adapter.model.aggregate(
          this.getOrganizationAggregationPipeline(query)
        );

        const tree = this.buildTree(allOrganizations);

        if (showDeleted === 'true') {
          this.sortTree(tree);
          markChildrenOfDeleted(tree);
          addParentNamePath(tree, '');
          return tree;
        }

        // Hàm đệ quy để lọc bỏ các node bị xóa và tất cả các node con của chúng
        const filterDeleted = nodes => {
          // Lọc bỏ những node có isDeleted: true
          const visibleNodes = nodes.filter(node => !node.isDeleted);

          // Với mỗi node còn lại, tiếp tục lọc các node con của nó
          for (const node of visibleNodes) {
            if (node.children && node.children.length > 0) {
              node.children = filterDeleted(node.children);
            }
          }
          return visibleNodes;
        };

        const filteredTree = filterDeleted(tree);
        this.sortTree(filteredTree);
        addParentNamePath(filteredTree, '');

        return filteredTree;
      },
    },
    getTreeByOrganizationType: {
      rest: 'GET /tree-by-type/:organizationTypeId',
      auth: 'required',
      permission: { resource: RESOURCES.ORGANIZATION, action: ACTIONS.VIEW },
      params: {
        organizationTypeId: { type: 'string' },
        showDeleted: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { organizationTypeId, showDeleted } = ctx.params;
        const { user } = ctx.meta;

        const showDeletedFlag = this.normalizeBoolean(showDeleted);

        const selectedOrgType = await this.broker.call(`${ORGANIZATION_TYPE_SERVICE}.get`, {
          id: organizationTypeId,
        });

        if (!selectedOrgType) {
          throw new MoleculerClientError(i18next.t('error_organization_type_not_found'), 404);
        }

        const allowedOrgTypeIds = (await this.getAllParentOrgTypes(selectedOrgType)).filter(
          typeId => typeId !== organizationTypeId,
        );

        if (allowedOrgTypeIds.length === 0) {
          return [];
        }

        let baseQuery = {
          organizationTypeId: { $in: allowedOrgTypeIds },
        };

        if (!showDeletedFlag) {
          baseQuery.isDeleted = false;
        }

        const query = await this.applyUserPermissionToQuery(user, baseQuery);

        const organizations = await this.adapter.model.find(query).populate('organizationTypeId').lean();
        return this.buildTree(organizations);
      },
    },
    getAllSelectParents: {
      rest: 'GET /select-parents',
      auth: 'required',
      // role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const { id } = ctx.params;

        // Nếu không có id (trường hợp tạo mới), trả về tất cả tổ chức
        if (!id) {
          return await this.adapter.find({ query: { isDeleted: false } });
        }

        const organizationId = new ObjectId(id);
        // Sử dụng $graphLookup để tìm tất cả các tổ chức con cháu
        const descendants = await OrganizationModel.aggregate([
          { $match: { _id: organizationId } },
          {
            $graphLookup: {
              from: 'Organization', // Tên collection trong MongoDB
              startWith: '$_id',
              connectFromField: '_id',
              connectToField: 'parentOrganizationId',
              as: 'descendants',
            },
          },
          {
            $project: {
              descendantIds: '$descendants._id',
            },
          },
        ]);

        let excludeIds = [organizationId];
        if (descendants.length > 0 && descendants[0].descendantIds) {
          excludeIds = [...excludeIds, ...descendants[0].descendantIds];
        }

        return await this.adapter.find({ query: { _id: { $nin: excludeIds }, isDeleted: false } });
      },
    },
    getScopeOrganizationIds: {
      visibility: 'protected',
      async handler(ctx) {
        const { id } = ctx.params;
        const organizationId = new ObjectId(id);

        const scope = await OrganizationModel.aggregate([
          { $match: { _id: organizationId } },
          {
            $graphLookup: {
              from: 'Organization',
              startWith: '$_id',
              connectFromField: 'parentOrganizationId',
              connectToField: '_id',
              as: 'ancestors',
            },
          },
          {
            $graphLookup: {
              from: 'Organization',
              startWith: '$_id',
              connectFromField: '_id',
              connectToField: 'parentOrganizationId',
              as: 'descendants',
            },
          },
          {
            $project: {
              ids: {
                $concatArrays: [['$_id'], '$ancestors._id', '$descendants._id'],
              },
            },
          },
        ]);

        if (scope.length > 0) {
          return Array.from(new Set(scope[0].ids.map(id => id.toString())));
        }
        return [id];
      },
    },
    getAllDescendants: {
      visibility: 'protected',
      params: {
        orgId: { type: 'string' },
      },
      async handler(ctx) {
        const { orgId } = ctx.params;
        const organizationId = new ObjectId(orgId);

        const result = await OrganizationModel.aggregate([
          { $match: { _id: organizationId, isDeleted: false } },
          {
            $graphLookup: {
              from: 'Organization',
              startWith: '$_id',
              connectFromField: '_id',
              connectToField: 'parentOrganizationId',
              as: 'descendants',
            },
          },
          {
            $project: {
              _id: 0,
              descendants: 1,
            },
          },
        ]);
        return result.length > 0 ? result[0].descendants : [];
      },
    },
    getOne: {
      rest: 'GET /:id/detail',
      auth: 'required',
      async handler(ctx) {
        const { id } = ctx.params;
        return await this.adapter.findById(id);
      },
    },
    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const { id } = ctx.params;
        const organization = await this.adapter.findById(id);
        if (!organization) {
          throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
        }

        // Tìm tất cả người dùng thuộc tổ chức này
        const members = await this.broker.call('users.find', {
          query: { organizationId: new ObjectId(id) },
        });

        // Tìm tất cả khóa học của tổ chức này
        const courses = await this.broker.call('courses.find', {
          query: { organizationId: new ObjectId(id) },
        });

        // Cập nhật vai trò và xóa organizationId cho tất cả thành viên
        if (members && members.length > 0) {
          const memberIds = members.map(m => m._id);
          await this.broker.call('users.updateMany', {
            query: { _id: { $in: memberIds } },
            update: { $set: { role: USER_CODES.NORMAL }, $unset: { organizationId: '' } },
          });
        }

        // Xóa organizationId cho tất cả khóa học
        if (courses && courses.length > 0) {
          const courseIds = courses.map(c => c._id);
          await this.broker.call('courses.updateMany', {
            query: { _id: { $in: courseIds } },
            update: { $unset: { organizationId: '' } },
          });
        }

        this.broker.emit('organization.removed', organization);
        return await this.adapter.removeById(id);
      },
    },
    softRemove: {
      rest: 'POST /:id/soft-remove',
      auth: 'required',
      permission: { resource: RESOURCES.ORGANIZATION, action: ACTIONS.DELETE },
      async handler(ctx) {
        const { id } = ctx.params;
        const organization = await this.adapter.findById(id);
        if (!organization) {
          throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
        }

        const descendantsResult = await OrganizationModel.aggregate([
          { $match: { _id: new ObjectId(id) } },
          {
            $graphLookup: {
              from: 'Organization',
              startWith: '$_id',
              connectFromField: '_id',
              connectToField: 'parentOrganizationId',
              as: 'descendants',
            },
          },
          {
            $project: {
              descendants: 1,
            },
          },
        ]);

        const descendants = descendantsResult.length > 0 ? descendantsResult[0].descendants || [] : [];
        const allOrgIds = [organization._id, ...descendants.map(desc => desc._id)].filter(Boolean);
        const uniqueOrgIds = Array.from(new Set(allOrgIds.map(orgId => orgId.toString()))).map(
          strId => new ObjectId(strId),
        );

        if (uniqueOrgIds.length === 0) {
          const updatedOrg = await this.adapter.updateById(id, { $set: { isDeleted: true } });
          this.broker.emit('organization.softRemoved', updatedOrg);
          return updatedOrg;
        }

        await this.adapter.model.updateMany({ _id: { $in: uniqueOrgIds } }, { $set: { isDeleted: true } });

        const updatedOrganizations = await this.adapter.model.find({ _id: { $in: uniqueOrgIds } }).lean();

        updatedOrganizations.forEach(org => {
          this.broker.emit('organization.softRemoved', org);
        });

        const parentUpdated = updatedOrganizations.find(org => org._id.toString() === id);
        return parentUpdated || organization;
      },
    },
    restore: {
      rest: 'POST /:id/restore',
      auth: 'required',
      permission: { resource: RESOURCES.ORGANIZATION, action: ACTIONS.RESTORE },
      async handler(ctx) {
        const { id } = ctx.params;
        const organization = await this.adapter.findById(id);
        if (!organization) {
          throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
        }

        // Khôi phục bằng cách đặt isDeleted thành false
        const restoredOrg = await this.adapter.updateById(id, { $set: { isDeleted: false } });
        this.broker.emit('organization.restored', restoredOrg);
        return restoredOrg;
      },
    },
    kickMembers: {
      rest: 'POST /kickMembers',
      auth: 'required',
      async handler(ctx) {
        const { organizationId, memberId } = ctx.params;
        const { user: currentUser } = ctx.meta;

        // 1. Kiểm tra quyền hạn
        const organization = await this.adapter.findById(organizationId);
        if (!organization) {
          throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
        }

        // Chỉ System Admin hoặc Admin của chính tổ chức đó mới có quyền kick
        if (!currentUser.isSystemAdmin) {
          let hasPermission = false;
          let currentOrg = organization;

          while (currentOrg) {
            if (currentOrg._id === currentUser._id) {
              hasPermission = true;
              break;
            }
            if (!currentOrg.parentOrganizationId) break;
            currentOrg = await this.adapter.findById(currentOrg.parentOrganizationId);
          }

          if (!hasPermission) {
            throw new MoleculerClientError(i18next.t('error_permission_denied'), 403);
          }
        }

        const memberToKick = await this.broker.call('users.get', { id: memberId });
        if (!memberToKick) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        // Admin của tổ chức không thể tự kick chính mình
        if (memberToKick._id.toString() === organization.admin.toString()) {
          throw new MoleculerClientError(i18next.t('error_permission_denied'), 403, 'CANNOT_KICK_ADMIN');
        }

        // 2. Xóa người dùng khỏi danh sách members của tổ chức
        const updatedOrganization = await this.adapter.updateById(organizationId, { $pull: { members: memberToKick._id } });

        // 3. Cập nhật lại thông tin của người dùng bị kick
        await this.broker.call('users.update', {
          id: memberId,
          email: memberToKick.email,
          $set: { role: USER_CODES.NORMAL },
          $unset: { organizationId: '' },
        });

        return updatedOrganization;
      },
    },
  },
  async started() {
    try {
      const collection = this.adapter.model.collection;
      const indexes = await collection.indexes();

      const emailIndexExists = indexes.some(index => index.key.email !== undefined || index.name === 'email_1');

      if (emailIndexExists) {
        const possibleIndexNames = ['email_1', 'email'];

        for (const indexName of possibleIndexNames) {
          try {
            await collection.dropIndex(indexName);
          } catch (error) {
            if (error.code === 27 || error.codeName === 'IndexNotFound') {
              // Index không tồn tại, bỏ qua
            } else {
              this.logger.error(`Lỗi khi xóa index "${indexName}":`, error.message);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Lỗi khi kiểm tra/xóa index email:', error.message);
    }
  },

  methods: {
    buildTree(organizations = []) {
      if (organizations.length === 0) return [];

      const entries = organizations.reduce((accumulator, org) => {
        const id = this.normalizeId(org._id);
        if (!id) return accumulator;

        accumulator.push([
          id,
          {
            ...org,
            key: id,
            title: org.name,
            children: [],
          },
        ]);

        return accumulator;
      }, []);

      if (entries.length === 0) {
        return [];
      }

      const orgMap = new Map(entries);
      const tree = [];

      for (const node of orgMap.values()) {
        const parentId = this.normalizeId(node.parentOrganizationId);

        if (parentId && orgMap.has(parentId)) {
          orgMap.get(parentId).children.push(node);
        } else {
          tree.push(node);
        }
      }

      this.sortTree(tree);
      return tree;
    },
    sortTree(nodes) {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach(node => {
        if (node.children?.length > 0) {
          this.sortTree(node.children);
        }
      });
    },

    async getAllParentOrgTypes(orgType) {
      const allowedTypeIds = new Set([orgType._id.toString()]);
      const queue = [orgType];
      const visited = new Set();

      while (queue.length > 0) {
        const currentType = queue.shift();
        const currentId = currentType._id.toString();

        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);

        if (currentType.parentIds && currentType.parentIds.length > 0) {
          for (const parentId of currentType.parentIds) {
            const parentIdStr = parentId.toString();

            if (!allowedTypeIds.has(parentIdStr) && !visited.has(parentIdStr)) {
              try {
                const parentType = await this.broker.call(`${ORGANIZATION_TYPE_SERVICE}.get`, {
                  id: parentIdStr,
                });

                if (parentType && !parentType.isDeleted) {
                  allowedTypeIds.add(parentIdStr);
                  queue.push(parentType); // Thêm vào queue để xử lý parents của parent
                }
              } catch (error) {
                this.logger.warn(`Cannot get parent org type ${parentIdStr}:`, error.message);
              }
            }
          }
        }
      }

      return Array.from(allowedTypeIds);
    },

    async trackingOrganization(ctx, { name, parentName, adminName }, query, paramsList, sortAggregate) {
      return OrganizationModel.aggregate([
        {
          $match: {
            isDeleted: false,
            ...(query ? { createdAt: query.createdAt } : {}),
            ...(name && { name: { $regex: name, $options: 'i' } }),
          },
        },
        {
          $lookup: {
            from: 'Organization', // Tên collection của Organization
            localField: 'parentOrganizationId',
            foreignField: '_id',
            as: 'parentOrganizationId',
          },
        },
        {
          $lookup: {
            from: 'User', // Tên collection của Organization
            localField: 'admin',
            foreignField: '_id',
            as: 'admin',
          },
        },
        {
          $set: {
            parentOrganizationId: {
              $cond: [
                { $gt: [{ $size: '$parentOrganizationId' }, 0] },
                { $arrayElemAt: ['$parentOrganizationId', 0] },
                '$$REMOVE',
              ],
            },
            admin: {
              $cond: [{ $gt: [{ $size: '$admin' }, 0] }, { $arrayElemAt: ['$admin', 0] }, '$$REMOVE'],
            },
          },
        },
        {
          $match: {
            ...(parentName && { 'parentOrganizationId.name': { $regex: parentName, $options: 'i' } }),
            ...(adminName && { 'admin.fullName': { $regex: adminName, $options: 'i' } }),
          },
        },
        {
          // Thêm bước này để loại bỏ các trường nhạy cảm khỏi admin
          $project: {
            members: 0,
            __v: 0,
            'admin.password': 0,
            'admin.deviceTokens': 0,
            'admin.__v': 0,
            'parentOrganizationId.members': 0,
            'parentOrganizationId.__v': 0,
            // 'parentOrganizationId.admin': 0,
          },
        },
        { $sort: sortAggregate },
        {
          $facet: {
            rows: [{ $skip: (paramsList.page - 1) * paramsList.pageSize }, { $limit: paramsList.pageSize }],
            metadata: [
              { $count: 'total' },
              {
                $addFields: {
                  page: paramsList.page,
                  pageSize: paramsList.pageSize,
                  totalPages: { $ceil: { $divide: ['$total', paramsList.pageSize] } },
                },
              },
            ],
          },
        },
        {
          $project: {
            rows: 1,
            metadata: {
              $cond: {
                if: { $eq: [{ $size: '$metadata' }, 0] },
                then: [{ total: 0, page: 0, pageSize: 0, totalPages: 0 }],
                else: '$metadata',
              },
            },
          },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: ['$$ROOT', { $arrayElemAt: ['$metadata', 0] }],
            },
          },
        },
        { $unset: 'metadata' },
      ]);
    },
    async applyUserPermissionToQuery(user, baseQuery = {}) {
      if (user.isSystemAdmin) {
        return baseQuery;
      }

      if (user.organizationId) {
        const organizationId = new ObjectId(user.organizationId);
        const result = await OrganizationModel.aggregate([
          { $match: { _id: organizationId } },
          {
            $graphLookup: {
              from: 'Organization',
              startWith: '$_id',
              connectFromField: '_id',
              connectToField: 'parentOrganizationId',
              as: 'descendants',
            },
          },
          {
            $project: {
              _id: 0,
              descendants: 1,
            },
          },
        ]);

        const allowedOrgIds = [organizationId];
        if (result.length > 0 && result[0].descendants) {
          allowedOrgIds.push(...result[0].descendants.map(desc => desc._id));
        }

        return {
          ...baseQuery,
          _id: { $in: allowedOrgIds },
        };
      } else {
        return {
          ...baseQuery,
          _id: { $in: [] },
        };
      }
    },

    getOrganizationAggregationPipeline(query) {
      return [
        { $match: query },
        {
          $lookup: {
            from: 'OrganizationType',
            localField: 'organizationTypeId',
            foreignField: '_id',
            as: 'organizationTypeId',
          },
        },
        {
          $unwind: {
            path: '$organizationTypeId',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: 'Organization',
            localField: 'parentOrganizationId',
            foreignField: '_id',
            as: 'parentOrganizationId',
          },
        },
        {
          $unwind: {
            path: '$parentOrganizationId',
            preserveNullAndEmptyArrays: true,
          },
        },
      ];
    },

    async checkPermission(context) {
      const { action, params, meta } = context;
      const organizationId = params?.id || params?.organizationId || context.meta.$multipart.organizationId;
      const { user } = meta;

      // Nếu không có user trong meta (ví dụ: gọi nội bộ) hoặc user là System Admin, bỏ qua kiểm tra quyền
      if (!user || user.isSystemAdmin) {
        return;
      }

      delete context.params.email;
      delete context.params.isDeleted;
      delete context.params.active;

      if (user.role !== USER_CODES.ORG_ADMIN) {
        throw new MoleculerClientError(i18next.t('you_need_to_be_an_admin'), 403, 'FORBIDDEN');
      }

      const organization = await this.adapter.findById(organizationId);
      if (!organization) {
        throw new MoleculerClientError(i18next.t('error_organization_not_found'), 404);
      }

      if (organization?.active === false) {
        throw new MoleculerClientError(i18next.t('organization_already_locked'), 423);
      }
    },
  },
};
