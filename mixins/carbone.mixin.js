'use strict';

const carbone = require('carbone');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  methods: {
    async generateDocument(data, templateFilePath, convertToPdf = false, convertToXLSX = false) {
      const options = {
        renderPrefix: 'report',
        reportName: 'Report',
        timezone: 'Asia/Saigon',
        ...(convertToPdf && {convertTo: 'pdf'}),
        ...(convertToXLSX && {convertTo: 'xlsx'}),
      };
      return new Promise((resolve, reject) => {
        carbone.render(templateFilePath, data, options, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });
    },

    async mergeExcelBuffersToMultiSheet(sources) {
      const JSZip = require('jszip');

      if (!sources || sources.length === 0) return null;
      if (sources.length === 1) return sources[0].filePath;

      // Lấy file đầu tiên làm base (giữ nguyên styles.xml, theme, sharedStrings cho sheet 1)
      const baseZip = await JSZip.loadAsync(fs.readFileSync(sources[0].filePath));

      let wbXml = await baseZip.file('xl/workbook.xml').async('string');
      let relsXml = await baseZip.file('xl/_rels/workbook.xml.rels').async('string');
      let ctXml = await baseZip.file('[Content_Types].xml').async('string');

      // Đổi tên sheet đầu tiên
      wbXml = wbXml.replace(
        /(<sheet\s[^>]*?name=")([^"]*?)(")/,
        `$1${this._escapeXmlAttr(sources[0].sheetName)}$3`,
      );

      // Tìm rId và sheetId cao nhất hiện có
      let maxRId = 0;
      const rIdRe = /Id="rId(\d+)"/g;
      let m;
      while ((m = rIdRe.exec(relsXml)) !== null) maxRId = Math.max(maxRId, parseInt(m[1]));

      let maxSheetId = 0;
      const sidRe = /sheetId="(\d+)"/g;
      while ((m = sidRe.exec(wbXml)) !== null) maxSheetId = Math.max(maxSheetId, parseInt(m[1]));

      // Thêm từng file bổ sung
      for (let i = 1; i < sources.length; i++) {
        const { filePath, sheetName } = sources[i];
        const srcZip = await JSZip.loadAsync(fs.readFileSync(filePath));

        // Đọc shared strings của file nguồn
        const srcSSXml = await srcZip.file('xl/sharedStrings.xml')?.async('string');
        const sharedStrings = this._parseSharedStrings(srcSSXml || '');

        // Tìm file worksheet thực tế
        const srcWbXml = await srcZip.file('xl/workbook.xml')?.async('string');
        const srcRelsXml = await srcZip.file('xl/_rels/workbook.xml.rels')?.async('string');
        const wsTarget = this._findSheetTarget(srcWbXml, srcRelsXml);

        let wsXml = await srcZip.file(`xl/${wsTarget}`)?.async('string');
        if (!wsXml) continue;

        // Convert shared string refs sang inline strings (giữ nguyên style index)
        if (sharedStrings.length > 0) {
          wsXml = this._convertToInlineStrings(wsXml, sharedStrings);
        }

        // Thêm worksheet vào base zip
        const sheetFileName = `sheet${i + 1}.xml`;
        baseZip.file(`xl/worksheets/${sheetFileName}`, wsXml);

        // Thêm relationship
        maxRId++;
        const newRId = `rId${maxRId}`;
        relsXml = relsXml.replace(
          '</Relationships>',
          `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetFileName}"/></Relationships>`,
        );

        // Thêm sheet vào workbook.xml
        maxSheetId++;
        wbXml = wbXml.replace(
          '</sheets>',
          `<sheet name="${this._escapeXmlAttr(sheetName)}" sheetId="${maxSheetId}" r:id="${newRId}"/></sheets>`,
        );

        // Thêm content type
        ctXml = ctXml.replace(
          '</Types>',
          `<Override PartName="/xl/worksheets/${sheetFileName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        );
      }

      // Lưu lại các XML đã cập nhật
      baseZip.file('xl/workbook.xml', wbXml);
      baseZip.file('xl/_rels/workbook.xml.rels', relsXml);
      baseZip.file('[Content_Types].xml', ctXml);

      // Ghi ra file tạm
      const outBuffer = await baseZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const tmpFilePath = path.join(os.tmpdir(), `merged_report_${Date.now()}.xlsx`);
      fs.writeFileSync(tmpFilePath, outBuffer);
      return tmpFilePath;
    },

    /** Parse shared strings XML, trả về mảng inner XML của từng <si> */
    _parseSharedStrings(ssXml) {
      const strings = [];
      const re = /<si>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = re.exec(ssXml)) !== null) strings.push(m[1]);
      return strings;
    },

    /** Convert cell references t="s" sang t="inlineStr" với nội dung inline */
    _convertToInlineStrings(wsXml, sharedStrings) {
      return wsXml.replace(
        /<c\b([^>]*?)\bt="s"([^>]*)>([\s\S]*?)<\/c>/g,
        (full, before, after, content) => {
          const vMatch = content.match(/<v>(\d+)<\/v>/);
          if (!vMatch) return full;
          const idx = parseInt(vMatch[1]);
          if (idx >= sharedStrings.length) return full;
          const newAttrs = `${before}t="inlineStr"${after}`;
          return `<c${newAttrs}><is>${sharedStrings[idx]}</is></c>`;
        },
      );
    },

    /** Tìm target path của sheet đầu tiên từ workbook.xml + rels */
    _findSheetTarget(wbXml, relsXml) {
      if (!wbXml || !relsXml) return 'worksheets/sheet1.xml';
      const sm = wbXml.match(/<sheet[^>]*?r:id="([^"]+)"/);
      if (!sm) return 'worksheets/sheet1.xml';
      const re = new RegExp(`Id="${sm[1]}"[^>]*?Target="([^"]+)"`, 'i');
      const rm = relsXml.match(re);
      return rm ? rm[1] : 'worksheets/sheet1.xml';
    },

    _escapeXmlAttr(str) {
      return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
};
