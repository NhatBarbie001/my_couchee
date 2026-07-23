'use strict';

const ENABLED_VALUES = new Set(['true', '1']);

function isFlagEnabled(name, defaultValue = false) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  return ENABLED_VALUES.has(String(rawValue).trim().toLowerCase());
}

function getFlagValue(name, defaultValue = false) {
  const value = isFlagEnabled(name, defaultValue);
  return { name, value };
}

module.exports = {
  isFlagEnabled,
  getFlagValue,
};
