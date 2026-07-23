const DbMongoose = require('../../mixins/dbMongo.mixin');
const OrganizationTypeModel = require('./organizationType.model');
const BaseService = require('../../mixins/baseService.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {SERVICE_NAME} = require('./index');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const {MoleculerClientError} = require('moleculer').Errors;
const i18next = require('i18next');
const {RESOURCES, ACTIONS} = require('../../constants/permissions');

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(OrganizationTypeModel), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.CATEGORY,
    rest: '/organizationtypes',
    populates: {
      parentIds: `${SERVICE_NAME}.get`,
    },
    populateOptions: ['parentIds'],
  },

  actions: {
    create: {
      rest: 'POST /',
      auth: 'required',
      params: {
        name: {type: 'string', min: 1, max: 100, trim: true},
        description: {type: 'string', optional: true, max: 500, trim: true},
        parentIds: {type: 'array', items: 'string', optional: true},
        active: {type: 'boolean', optional: true, default: true},
      },
      async handler(ctx) {
        const {name, description, parentIds, active} = ctx.params;

        // Kiểm tra tên loại đơn vị đã tồn tại chỉ kiểm tra khi cùng cấp trên
        const existingType = await this.adapter.findOne({
          name: name.trim(),
          isDeleted: false,
        });

        if (existingType) {
          throw new MoleculerClientError(
            i18next.t('error_organization_type_name_exists'),
            400,
            'ORGANIZATION_TYPE_NAME_EXISTS',
          );
        }

        if (parentIds && parentIds.length > 0) {
          // Kiểm tra các parent có tồn tại và active không
          for (const parentId of parentIds) {
            const parentType = await this.adapter.findOne({
              _id: parentId,
              isDeleted: false,
            });

            if (!parentType) {
              throw new MoleculerClientError(
                i18next.t('error_parent_organization_type_not_found'),
                404,
                'PARENT_ORGANIZATION_TYPE_NOT_FOUND',
              );
            }
          }

          for (const parentId of parentIds) {
            const otherParentIds = parentIds.filter(id => id !== parentId);
            if (otherParentIds.length > 0) {
              const hasCircularRef = await this.checkCircularReference(parentId, otherParentIds);
              if (hasCircularRef) {
                throw new MoleculerClientError(
                  i18next.t('error_organization_type_circular_reference'),
                  400,
                  'ORGANIZATION_TYPE_CIRCULAR_REFERENCE',
                );
              }
            }
          }
        }

        const newType = await this.adapter.insert({
          name: name.trim(),
          description: description?.trim(),
          parentIds: parentIds && parentIds.length > 0 ? parentIds : [],
          isDeleted: false,
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, newType);
      },
    },

    update: {
      rest: 'PUT /:id',
      auth: 'required',
      params: {
        id: {type: 'string'},
        name: {type: 'string', min: 1, max: 100, trim: true, optional: true},
        description: {type: 'string', optional: true, max: 500, trim: true},
        parentIds: {type: 'array', items: 'string', optional: true},
      },
      async handler(ctx) {
        const {id, name, description, parentIds, active} = ctx.params;

        const organizationType = await this.adapter.findById(id);
        if (!organizationType || organizationType.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error_organization_type_not_found'),
            404,
            'ORGANIZATION_TYPE_NOT_FOUND',
          );
        }

        if (name && name.trim() !== organizationType.name) {
          const existingType = await this.adapter.findOne({
            name: name.trim(),
            isDeleted: false,
            _id: {$ne: id},
          });

          if (existingType) {
            throw new MoleculerClientError(
              i18next.t('error_organization_type_name_exists'),
              400,
              'ORGANIZATION_TYPE_NAME_EXISTS',
            );
          }
        }

        if (parentIds !== undefined) {
          if (parentIds && parentIds.length > 0) {
            const hasCircularRef = await this.checkCircularReference(id, parentIds);
            if (hasCircularRef) {
              throw new MoleculerClientError(
                i18next.t('error_organization_type_circular_reference'),
                400,
                'ORGANIZATION_TYPE_CIRCULAR_REFERENCE',
              );
            }

            for (const parentId of parentIds) {
              const parentType = await this.adapter.findOne({
                _id: parentId,
                isDeleted: false,
              });

              if (!parentType) {
                throw new MoleculerClientError(
                  i18next.t('error_parent_organization_type_not_found'),
                  404,
                  'PARENT_ORGANIZATION_TYPE_NOT_FOUND',
                );
              }
            }
          }
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim();
        if (parentIds !== undefined) updateData.parentIds = parentIds || [];
        if (active !== undefined) updateData.active = active;

        const updatedType = await this.adapter.updateById(id, {$set: updateData});
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updatedType);
      },
    },

    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const organizationType = await this.adapter.findById(id);
        if (!organizationType || organizationType.isDeleted) {
          throw new MoleculerClientError(i18next.t('error_organization_type_not_found'), 404);
        }
        const organizationsUsingType = await this.broker.call('organizations.count', {
          query: {
            organizationTypeId: id,
            isDeleted: false,
          },
        });

        if (organizationsUsingType > 0) {
          throw new MoleculerClientError(i18next.t('error_organization_type_in_use'), 400, 'ORGANIZATION_TYPE_IN_USE');
        }

        // Kiểm tra có loại đơn vị con không (với parentIds array)
        const childTypes = await this.adapter.count({query: {parentIds: id, isDeleted: false}});
        if (childTypes > 0) {
          throw new MoleculerClientError(
            i18next.t('error_organization_type_has_children'),
            400,
            'ORGANIZATION_TYPE_HAS_CHILDREN',
          );
        }

        const deletedType = await this.adapter.updateById(id, {
          $set: {isDeleted: true},
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, deletedType);
      },
    },

    getTree: {
      rest: 'GET /tree',
      auth: 'required',
      async handler(ctx) {
        const {user} = ctx.meta;
        const {includeUserOrgType, allTree} = ctx.params;

        if ((user && user.isSystemAdmin) || allTree) {
          return this.buildFullTree();
        }

        let userOrgTypeId = null;
        if (user && user.organizationId) {
          const userOrg = await this.broker.call('organizations.get', {id: user.organizationId.toString()});
          if (userOrg && userOrg.organizationTypeId) {
            userOrgTypeId = userOrg.organizationTypeId._id || userOrg.organizationTypeId;
          }
        }

        if (!userOrgTypeId) {
          return [];
        }

        const childTypes = await this.getAllDescendants(userOrgTypeId);

        if (includeUserOrgType) {
          const userOrgType = await this.adapter.findById(userOrgTypeId);
          if (userOrgType) {
            childTypes.unshift(userOrgType);
          }
        }

        // Build tree từ các loại đơn vị con
        return this.buildTreeFromTypes(childTypes);
      },
    },
    restore: {
      rest: 'POST /:id/restore',
      auth: 'required',
      permission: {resource: RESOURCES.CATEGORY, action: ACTIONS.RESTORE},
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const organizationType = await this.adapter.findById(id);
        if (!organizationType) {
          throw new MoleculerClientError(i18next.t('error_organization_type_not_found'), 404);
        }

        const restoredType = await this.adapter.updateById(id, {
          $set: {isDeleted: false},
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, restoredType);
      },
    },
  },

  methods: {
    async checkCircularReference(nodeId, parentIds) {
      if (!parentIds || parentIds.length === 0) return false;

      // Kiểm tra trực tiếp xem nodeId có trong parentIds không (tự làm cha của chính mình)
      if (parentIds.some(parentId => parentId.toString() === nodeId.toString())) {
        return true;
      }

      // Kiểm tra descendants của nodeId có chứa bất kỳ parentId nào không
      const descendants = await this.getAllDescendants(nodeId);
      const descendantIds = descendants.map(d => d._id.toString());

      // Nếu bất kỳ parentId nào là descendant của nodeId thì có circular reference
      return parentIds.some(parentId => descendantIds.includes(parentId.toString()));
    },

    async getAllDescendants(nodeId) {
      const visited = new Set();
      const descendants = [];

      const traverse = async currentId => {
        if (visited.has(currentId.toString())) return;
        visited.add(currentId.toString());

        // Tìm tất cả children của currentId
        const children = await this.adapter.find({
          query: {
            parentIds: currentId,
            isDeleted: false,
          },
        });

        for (const child of children) {
          descendants.push(child);
          await traverse(child._id);
        }
      };

      await traverse(nodeId);
      return descendants;
    },

    async buildFullTree() {
      const allTypes = await this.adapter.find({query: {isDeleted: false, active: true}});

      const typeMap = new Map();
      const rootNodes = new Set();

      allTypes.forEach(type => {
        const plainType = type.toObject ? type.toObject() : type;
        const typeNode = {
          _id: plainType._id,
          name: plainType.name,
          description: plainType.description,
          parentIds: plainType.parentIds || [],
          active: plainType.active,
          key: plainType._id.toString(),
          value: plainType._id.toString(),
          title: plainType.name,
          children: [],
        };
        typeMap.set(typeNode.key, typeNode);

        if (!plainType.parentIds || plainType.parentIds.length === 0) {
          rootNodes.add(typeNode.key);
        }
      });

      const buildSubTree = (nodeId, parentKey = null, visited = new Set()) => {
        if (visited.has(nodeId)) {
          return null;
        }

        const originalNode = typeMap.get(nodeId);
        if (!originalNode) return null;

        visited.add(nodeId);

        const nodeKey = parentKey ? `${parentKey}_${nodeId}` : nodeId;

        const nodeInTree = {
          _id: originalNode._id,
          name: originalNode.name,
          description: originalNode.description,
          parentIds: originalNode.parentIds,
          active: originalNode.active,
          key: nodeKey,
          value: nodeKey,
          title: originalNode.title,
          children: [],
        };

        for (const [childId, childNode] of typeMap.entries()) {
          if (childNode.parentIds && childNode.parentIds.some(parentId => parentId.toString() === nodeId)) {
            const childSubTree = buildSubTree(childId, nodeKey, new Set(visited));
            if (childSubTree) {
              nodeInTree.children.push(childSubTree);
            }
          }
        }

        return nodeInTree;
      };

      const tree = [];
      for (const rootKey of rootNodes) {
        const rootSubTree = buildSubTree(rootKey);
        if (rootSubTree) {
          tree.push(rootSubTree);
        }
      }

      return tree;
    },

    buildTreeFromTypes(types) {
      if (!types || types.length === 0) {
        return [];
      }

      const typeMap = new Map();
      const rootNodes = new Set();

      types.forEach(type => {
        const plainType = type.toObject ? type.toObject() : type;
        const typeNode = {
          _id: plainType._id,
          name: plainType.name,
          description: plainType.description,
          parentIds: plainType.parentIds || [],
          active: plainType.active,
          key: plainType._id.toString(),
          value: plainType._id.toString(),
          title: plainType.name,
          children: [],
        };
        typeMap.set(typeNode.key, typeNode);
      });

      // Tìm root nodes trong danh sách types
      types.forEach(type => {
        const plainType = type.toObject ? type.toObject() : type;
        const typeId = plainType._id.toString();

        // Kiểm tra xem có parent nào trong danh sách types không
        const hasParentInList =
          plainType.parentIds && plainType.parentIds.some(parentId => typeMap.has(parentId.toString()));

        if (!hasParentInList) {
          rootNodes.add(typeId);
        }
      });

      const buildSubTree = (nodeId, parentKey = null, visited = new Set()) => {
        if (visited.has(nodeId)) {
          return null;
        }

        const originalNode = typeMap.get(nodeId);
        if (!originalNode) return null;

        visited.add(nodeId);

        const nodeKey = parentKey ? `${parentKey}_${nodeId}` : nodeId;

        const nodeInTree = {
          _id: originalNode._id,
          name: originalNode.name,
          description: originalNode.description,
          parentIds: originalNode.parentIds,
          active: originalNode.active,
          key: nodeKey,
          value: nodeKey,
          title: originalNode.title,
          children: [],
        };

        for (const [childId, childNode] of typeMap.entries()) {
          if (childNode.parentIds && childNode.parentIds.some(parentId => parentId.toString() === nodeId)) {
            const childSubTree = buildSubTree(childId, nodeKey, new Set(visited));
            if (childSubTree) {
              nodeInTree.children.push(childSubTree);
            }
          }
        }

        return nodeInTree;
      };

      const tree = [];
      for (const rootKey of rootNodes) {
        const rootSubTree = buildSubTree(rootKey);
        if (rootSubTree) {
          tree.push(rootSubTree);
        }
      }

      return tree;
    },

    async seedDB() {
      this.logger.info('Seed OrganizationType DB...');

      const organizationTypes = [
        {
          name: 'Công ty',
          description: 'Công ty - Cấp cao nhất trong tổ chức',
          level: 1,
          active: true,
        },
        {
          name: 'Tổng công ty',
          description: 'Tổng công ty - Tập đoàn lớn',
          level: 1,
          active: true,
        },
        {
          name: 'Chi nhánh',
          description: 'Chi nhánh - Đơn vị trực thuộc công ty',
          level: 2,
          active: true,
        },
        {
          name: 'Hội sở',
          description: 'Hội sở - Trụ sở chính',
          level: 2,
          active: true,
        },
        {
          name: 'Phòng',
          description: 'Phòng - Đơn vị cấp phòng',
          level: 3,
          active: true,
        },
        {
          name: 'Bộ phận',
          description: 'Bộ phận - Đơn vị nhỏ nhất',
          level: 4,
          active: true,
        },
      ];

      for (const orgType of organizationTypes) {
        await this.adapter.insert(orgType);
        this.logger.info(`Created organization type: ${orgType.name}`);
      }

      this.logger.info(`Generated ${organizationTypes.length} organization types!`);
    },
  },
  async started() {
    try {
      const collection = this.adapter.model.collection;
      const indexes = await collection.indexes();

      const emailIndexExists = indexes.some(index => index.key.name !== undefined || index.name === 'name_1');

      if (emailIndexExists) {
        const possibleIndexNames = ['name_1', 'name'];

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
  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
