'use strict';

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('moleculer-db').MoleculerDB} MoleculerDB  Moleculer's DB Service Schema
 */
const {PERMISSION_ACCESS} = require('../constants/constant');
const axios = require('axios');

module.exports = {
  methods: {
    groupBy(listData, key) {
      return listData.reduce(function (grouped, element) {
        (grouped[element[key]] = grouped[element[key]] || []).push(element);
        return grouped;
      }, {});
    },

    extractIdFromList(listData = []) {
      return listData.map(element => element?._id?.toString());
    },

    extractKeyFromList(listData = [], key) {
      return listData.map(element => element[key]?.toString());
    },

    secondsToHMS(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;

      const formattedHours = String(hours).padStart(2, '0');
      const formattedMinutes = String(minutes).padStart(2, '0');
      const formattedSeconds = String(remainingSeconds).padStart(2, '0');

      return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
    },
    secondsToMS(seconds) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedSeconds = remainingSeconds.toString().padStart(2, '0');
      return `${formattedMinutes}:${formattedSeconds}`;
    },

    getUniqueObjects(arrayData, key) {
      const uniqueObjectsSet = new Set();
      return arrayData.reduce((result, item) => {
        if (!uniqueObjectsSet.has(item[key])) {
          uniqueObjectsSet.add(item[key]);
          result.push(item);
        }
        return result;
      }, []);
    },
    lineBreak(string) {
      return `${string}\n`;
    },

    editAccess(accessLevel) {
      switch (accessLevel) {
        case PERMISSION_ACCESS.NO_PERMISSION:
        case PERMISSION_ACCESS.VIEWER:
          return false;
        case PERMISSION_ACCESS.OWNER:
        case PERMISSION_ACCESS.EDITOR:
          return true;
      }
      return false;
    },

    extractParamsList(params) {
      const {page, limit, sort} = params;
      return {
        page: +page || 1,
        pageSize: +limit || 10,
        sort: sort || '-createdAt',
      };
    },
    extractParamsPage(params) {
      const {page, pageSize, sort} = params;
      return {
        page: +page || 1,
        pageSize: +pageSize || 10,
        sort: sort || '-createdAt',
      };
    },

    getUniqueID() {
      return Math.random().toString(36).substring(2, 16);
    },

    imageTypeFromBase64(base64) {
      const types = {
        i: 'image/png',
        I: 'image/png',
        '/': 'image/jpeg',
        R: 'image/gif',
        U: 'image/webp',
      };

      return types[base64.charAt(0)] || 'image/jpeg';
    },
    normalizeBoolean(value) {
      if (value === true || value === 'true' || value === 1 || value === '1') return true;
      if (value === false || value === 'false' || value === 0 || value === '0') return false;
      return Boolean(value);
    },
    normalizeId(value) {
      if (!value) return undefined;
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value?._id) return value._id.toString();
      if (typeof value?.toString === 'function') return value.toString();
      return undefined;
    },
    normalizeText(text) {
      if (typeof text !== 'string') {
        return '';
      }
      return (
        text
          .toLowerCase()
          // Xóa các dấu câu phổ biến. Bạn có thể tùy chỉnh regex này nếu cần.
          .replace(/[.,!?;:()"'-]/g, '')
          // Thay thế nhiều khoảng trắng liên tiếp bằng một khoảng trắng duy nhất
          .replace(/\s+/g, ' ')
          // Xóa khoảng trắng ở đầu và cuối chuỗi
          .trim()
      );
    },
    calculateWER(referenceText, hypothesisText) {
      const refClean = this.normalizeText(referenceText);
      const hypClean = this.normalizeText(hypothesisText);

      // Tách thành mảng các từ
      const refWords = refClean.split(' ').filter(word => word.length > 0); // Lọc bỏ từ rỗng nếu có
      const hypWords = hypClean.split(' ').filter(word => word.length > 0); // Lọc bỏ từ rỗng nếu có

      const n = refWords.length; // Số từ trong tham chiếu
      const m = hypWords.length; // Số từ trong giả thuyết

      // ---- Xử lý các trường hợp đặc biệt ----
      // Nếu cả hai đều rỗng sau khi chuẩn hóa
      if (n === 0 && m === 0) {
        return 0.0; // Không có lỗi
      }
      // Nếu tham chiếu rỗng nhưng giả thuyết có từ
      if (n === 0) {
        // Theo định nghĩa WER = (S+D+I)/N, mẫu số N=0.
        // Có thể coi là lỗi vô hạn hoặc 100% lỗi chèn.
        // Trả về Infinity hoặc một giá trị lớn để biểu thị điều này.
        // Hoặc, nếu bạn muốn tính số lần chèn, bạn có thể trả về m.
        // Ở đây chúng ta trả về Infinity theo định nghĩa chặt chẽ.
        return Infinity;
      }
      // Nếu giả thuyết rỗng nhưng tham chiếu có từ
      if (m === 0) {
        // Tất cả các từ trong tham chiếu đều bị xóa (D = n).
        return 1.0; // WER = n / n = 1.0 (100% lỗi xóa)
      }

      // ---- Thuật toán Quy hoạch động (Levenshtein cho từ) ----
      // Tạo ma trận khoảng cách (n+1) x (m+1)
      const dp = Array(n + 1)
        .fill(null)
        .map(() => Array(m + 1).fill(0));

      // Khởi tạo hàng đầu tiên (chi phí chèn từ của giả thuyết vào tham chiếu rỗng)
      for (let j = 0; j <= m; j++) {
        dp[0][j] = j; // Cần j thao tác chèn
      }

      // Khởi tạo cột đầu tiên (chi phí xóa từ của tham chiếu để thành giả thuyết rỗng)
      for (let i = 0; i <= n; i++) {
        dp[i][0] = i; // Cần i thao tác xóa
      }

      // Điền vào phần còn lại của ma trận
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          // Chi phí thay thế: 0 nếu từ giống nhau, 1 nếu khác nhau
          const substitutionCost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;

          dp[i][j] = Math.min(
            dp[i - 1][j] + 1, // Lỗi xóa (Deletion) từ tham chiếu
            dp[i][j - 1] + 1, // Lỗi chèn (Insertion) vào tham chiếu
            dp[i - 1][j - 1] + substitutionCost, // Lỗi thay thế (Substitution) hoặc khớp (Match)
          );
        }
      }

      // Tổng số lỗi (S + D + I) là giá trị ở góc dưới cùng bên phải của ma trận
      const totalErrors = dp[n][m];

      // Tính WER
      const wer = totalErrors / n;

      return wer;
    },

    convertAzureScoreToIELTS(vocabularyScore, grammarScore, pronScore, fluencyScore) {
      const scoreMapping = [
        {min: 0, max: 45, score: 2.0},
        {min: 46, max: 55, score: 3.0},
        {min: 56, max: 65, score: 4.0},
        {min: 66, max: 75, score: 5.0},
        {min: 76, max: 80, score: 6.0},
        {min: 81, max: 85, score: 7.0},
        {min: 86, max: 95, score: 8.0},
        {min: 96, max: 100, score: 9.0},
      ];

      const convertSingleScoreToIELTS = score => {
        const mapping = scoreMapping.find(({min, max}) => score >= min && score <= max);
        return mapping ? mapping.score : 0;
      };

      return {
        vocabularyScore: vocabularyScore + 0.5,
        grammarScore: grammarScore + 0.5,
        pronScore: convertSingleScoreToIELTS(pronScore),
        fluencyScore: convertSingleScoreToIELTS(fluencyScore),
      };
    },
    validateYouTubeUrl(urlToParse) {
      if (urlToParse) {
        const regExp =
          /^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;
        if (urlToParse.match(regExp)) {
          return true;
        }
      }
      return false;
    },
    async imageUrlToBase64(imageUrl) {
      try {
        const response = await axios.get(imageUrl, {responseType: 'arraybuffer'});
        return Buffer.from(response.data, 'binary').toString('base64');
      } catch (error) {
        console.error('Error converting image to base64:', error);
        throw error;
      }
    },
    extractQueryTime(params) {
      const {time, fromDate, toDate} = params;
      let createdAtQuery = {};
      switch (time) {
        case 'month':
          const {firstDay, lastDay} = this.getMonthRange();
          createdAtQuery = {$gte: firstDay, $lte: lastDay};
          break;
        case 'week':
          const {firstDay: weekFirstDay, lastDay: weekLastDay} = this.getWeekRange();
          createdAtQuery = {$gte: weekFirstDay, $lte: weekLastDay};
          break;
        case 'custom':
          createdAtQuery = {
            $gte: fromDate ? new Date(fromDate * 1000) : new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            $lte: toDate
              ? new Date(toDate * 1000)
              : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999),
          };
          break;
        default:
          const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
          const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
          createdAtQuery = {$gte: startOfMonth, $lte: endOfMonth};
          break;
      }

      return {createdAt: createdAtQuery};
    },
    getMonthRange() {
      const date = new Date();
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return {firstDay, lastDay};
    },
    getWeekRange() {
      const date = new Date();
      const firstDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
      const lastDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay() + 7);
      return {firstDay, lastDay};
    },
    getMonthRangeGMT7() {
      // Tính ngày đầu và cuối tháng theo GMT+7
      // Server UTC, client GMT+7 (+7h)
      // 0h00 ngày 1/2 GMT+7 = 17h00 ngày 31/1 UTC (ngày trước)
      // 23:59:59 ngày 28/2 GMT+7 = 16:59:59 ngày 28/2 UTC

      const now = new Date();
      // Tính ngày hiện tại theo GMT+7
      const offsetHours = 7;
      const utcHours = now.getUTCHours();
      const localHoursGMT7 = utcHours + offsetHours;

      let year = now.getUTCFullYear();
      let month = now.getUTCMonth();
      let day = now.getUTCDate();

      // Nếu giờ local GMT+7 >= 24, nghĩa là đã sang ngày mới ở GMT+7
      if (localHoursGMT7 >= 24) {
        day += 1;
        // Xử lý overflow ngày
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        if (day > daysInMonth) {
          day = 1;
          month += 1;
          if (month > 11) {
            month = 0;
            year += 1;
          }
        }
      }

      // Ngày đầu tháng: 0h00 GMT+7 = (24 - 7) = 17h00 UTC ngày trước
      const firstDayUTC = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      firstDayUTC.setUTCHours(firstDayUTC.getUTCHours() - offsetHours);

      // Ngày cuối tháng: 23:59:59.999 GMT+7 = 16:59:59.999 UTC cùng ngày
      const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const lastDayUTC = new Date(Date.UTC(year, month, lastDayOfMonth, 23, 59, 59, 999));
      lastDayUTC.setUTCHours(lastDayUTC.getUTCHours() - offsetHours);

      return {firstDay: firstDayUTC, lastDay: lastDayUTC};
    },
    /**
     * Tạo tên bản sao theo cơ chế Windows Explorer.
     * - Lần đầu: "Tên - Bản sao"
     * - Lần 2: "Tên (2) - Bản sao"
     * - Lần 3: "Tên (3) - Bản sao"
     * @param {object} adapter - DB adapter để tìm kiếm bản sao đã tồn tại
     * @param {string} originalName - Tên gốc cần copy
     * @param {object} queryFilter - Bộ lọc bổ sung khi tìm kiếm (ví dụ: {isDeleted: false})
     * @returns {Promise<string>} Tên bản sao mới
     */
    async generateCopyName(adapter, originalName, queryFilter = {}) {
      // Tách lấy base name bằng cách loại bỏ hậu tố copy nếu đã có
      const copyPattern = /^(.+?)(?:\s*\(\d+\))?\s*-\s*Bản sao$/;
      const match = originalName.match(copyPattern);
      const baseName = match ? match[1].trim() : originalName;

      // Escape ký tự đặc biệt regex trong baseName
      const escapedName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Tìm tất cả bản sao đã tồn tại: "baseName - Bản sao" và "baseName (N) - Bản sao"
      const regex = new RegExp(`^${escapedName}(\\s*\\(\\d+\\))?\\s*-\\s*Bản sao$`);

      const existingCopies = await adapter.find({
        query: {
          ...queryFilter,
          name: {$regex: regex},
        },
        fields: ['name'],
      });

      if (existingCopies.length === 0) {
        return `${baseName} - Bản sao`;
      }

      // Tìm số thứ tự lớn nhất hiện có
      // "Tên - Bản sao" (không có số) tính là 1
      let maxNum = 1;
      const numPattern = new RegExp(`^${escapedName}\\s*\\((\\d+)\\)\\s*-\\s*Bản sao$`);

      for (const copy of existingCopies) {
        const numMatch = copy.name.match(numPattern);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }

      const nextNum = maxNum + 1;
      return `${baseName} (${nextNum}) - Bản sao`;
    },

    getWeekRangeGMT7() {
      const now = new Date();
      const offsetHours = 7;
      const utcHours = now.getUTCHours();
      const localHoursGMT7 = utcHours + offsetHours;

      let year = now.getUTCFullYear();
      let month = now.getUTCMonth();
      let day = now.getUTCDate();

      // Nếu giờ local GMT+7 >= 24, nghĩa là đã sang ngày mới ở GMT+7
      if (localHoursGMT7 >= 24) {
        day += 1;
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        if (day > daysInMonth) {
          day = 1;
          month += 1;
          if (month > 11) {
            month = 0;
            year += 1;
          }
        }
      }

      // Tính ngày trong tuần theo GMT+7 (0 = Chủ nhật)
      const tempDate = new Date(Date.UTC(year, month, day));
      const dayOfWeek = tempDate.getUTCDay();

      // Ngày đầu tuần (Chủ nhật): 0h00 GMT+7
      const firstDayUTC = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
      firstDayUTC.setUTCHours(firstDayUTC.getUTCHours() - offsetHours);

      // Ngày cuối tuần (Thứ 7): 23:59:59.999 GMT+7
      const lastDayUTC = new Date(Date.UTC(year, month, day - dayOfWeek + 6, 23, 59, 59, 999));
      lastDayUTC.setUTCHours(lastDayUTC.getUTCHours() - offsetHours);

      return {firstDay: firstDayUTC, lastDay: lastDayUTC};
    },
  },
};
