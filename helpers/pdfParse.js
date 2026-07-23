var PDFJS = null;

function render_page(pageData) {
  let render_options = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  };

  return pageData.getTextContent(render_options)
    .then(function(textContent) {
      let lastY, text = '';
      for (let item of textContent.items) {
        if (lastY == item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      return text;
    });
}

const DEFAULT_OPTIONS = {
  pagerender: render_page,
  max: 0,
  version: 'v1.10.100',
};

async function PDF(dataBuffer, options) {
  let isDebugMode = false;

  let ret = {
    numpages: 0,
    numrender: 0,
    info: null,
    metadata: null,
    text: '',
    version: null,
    item: [],
  };

  if (typeof options == 'undefined') options = DEFAULT_OPTIONS;
  if (typeof options.pagerender != 'function') options.pagerender = DEFAULT_OPTIONS.pagerender;
  if (typeof options.max != 'number') options.max = DEFAULT_OPTIONS.max;
  if (typeof options.version != 'string') options.version = DEFAULT_OPTIONS.version;
  if (options.version == 'default') options.version = DEFAULT_OPTIONS.version;

  PDFJS = PDFJS ? PDFJS : require(`pdf-parse/lib/pdf.js/${options.version}/build/pdf.js`);

  ret.version = PDFJS.version;

  PDFJS.disableWorker = true;
  let doc = await PDFJS.getDocument(dataBuffer);
  ret.numpages = doc.numPages;

  let metaData = await doc.getMetadata().catch(function(err) {
    return null;
  });
  ret.info = metaData ? metaData.info : null;
  ret.metadata = metaData ? metaData.metadata : null;

  let counter = options.max <= 0 ? doc.numPages : options.max;
  counter = counter > doc.numPages ? doc.numPages : counter;

  ret.text = '';

  for (let i = 1; i <= counter; i++) {
    let pageText = await doc.getPage(i).then(pageData => options.pagerender(pageData)).catch((err) => {
      debugger;
      return '';
    });
    pageText.forEach(text => {
      text.pageNum = i;
    });
    ret.item = [...ret.item, ...pageText];
  }

  ret.numrender = counter;
  doc.destroy();

  return ret;
}

module.exports = PDF;
