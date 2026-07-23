'use strict';

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const templatesDir = path.join(__dirname, "templates");

module.exports = {
  actions: {
    exportOrganizationRanking: {
      rest: 'GET /organization-ranking/export',
      params: {
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: { type: 'string', optional: true },
        toDate: { type: 'string', optional: true },
        organizationId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        //call  getOrganizationRanking to get rankingData
        const rankingData = await this.broker.call('roleplay.statistics.getOrganizationRanking', ctx.params);

        let targetOrgId = ctx.params.organizationId;
        const user = ctx.meta.user;
        if (!targetOrgId && user && user.organizationId) {
          targetOrgId = user.organizationId.toString();
        }
        let rootOrg = null;
        let orgMap = {};
        if (targetOrgId) {
          try {
            rootOrg = await ctx.call('organizations.get', { id: targetOrgId });
            const descendants = await ctx.call('organizations.getAllDescendants', { orgId: targetOrgId });
            descendants.forEach(d => { orgMap[d._id.toString()] = d; });
            orgMap[targetOrgId] = rootOrg;
          } catch (e) {
            console.log('Error getting descendants for org', targetOrgId, e);
          }
        }

        const listData = rankingData.map((item, index) => {
          const org = orgMap[item.organizationId];
          const parentName = this.getParentOrgName(org || {}, orgMap, rootOrg);
          return {
            ...item,
            index: index + 1,
            parentOrganizationName: parentName,
          };
        });

        const data = {
          orgName: rootOrg?.name || 'Tất cả',
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
          list: listData,
        };
        const buffer = await this.generateDocument(data, this.getFilePath('organization_ranking.xlsx', templatesDir));

        const displayName = `Bảng xếp hạng đơn vị_${Date.now()}.xlsx`;
        const encodedName = encodeURIComponent(displayName);
        ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        ctx.meta.$responseHeaders = {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        };

        return buffer;
      },
    },
  },

  methods: {

    getParentOrgName(org, orgMap, rootOrg) {
      if (!org.parentOrganizationId) {
        return '';
      }
      const parentId = org.parentOrganizationId?._id ? org.parentOrganizationId._id.toString() : org.parentOrganizationId?.toString();
      if (!parentId) return '';

      if (rootOrg && parentId === rootOrg._id.toString()) {
        return rootOrg.name || '';
      }

      const parentOrg = orgMap[parentId];
      return parentOrg?.name || '';
    },
  },
};
