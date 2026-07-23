module.exports.TYPE_TOOL = {
  MEDIA: ["IMAGE", "AUDIO", "VIDEO"],
  TEXT: ["TEXT"],
};
const TOKEN_UNIT = 1000000;
module.exports.MODEL_PRICE = {
  "gpt-4": { priceInput: 10 / TOKEN_UNIT, priceOutput: 30 / TOKEN_UNIT },
  "gpt-3.5-turbo-1106": { priceInput: 1 / TOKEN_UNIT, priceOutput: 2 / TOKEN_UNIT },
  "gpt-3.5-turbo-0125": { priceInput: 0.5 / TOKEN_UNIT, priceOutput: 1.5 / TOKEN_UNIT },
  "ft:gpt-3.5-turbo": { priceInput: 3 / TOKEN_UNIT, priceOutput: 6 / TOKEN_UNIT }
};
