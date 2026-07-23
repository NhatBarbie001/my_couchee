import moment from 'moment';

const DATE_FORMATS = ['DD/MM/YYYY', 'DD/M/YYYY', moment.ISO_8601];
const YEAR_FORMATS = ['YYYY', 'DD/MM/YYYY', 'DD/M/YYYY', moment.ISO_8601];

export function convertDate(data) {
  try {
    return moment(data, DATE_FORMATS, true).isValid() ? moment(data, DATE_FORMATS) : null;
  } catch (e) {
    return null;
  }
}

export function convertYear(data) {
  try {
    return moment(data, YEAR_FORMATS, true).isValid() ? moment(data, YEAR_FORMATS) : null;
  } catch (e) {
    return null;
  }
}

export function checkYear(value) {
  return !value || moment(value, YEAR_FORMATS, true).isValid();
}

export function checkNumber(value) {
  return value === undefined || isFinite(value) || value?.trim()?.toLowerCase().includes('không');
}

export function checkDate(value) {
  return !value || moment(value, DATE_FORMATS, true).isValid();
}

export function momentValid(date) {
  return date && moment(new Date(date)).isValid();
}

export function convertMoment(dateTime) {
  try {
    return momentValid(dateTime) ? moment(new Date(dateTime)) : '';
  } catch (e) {
    return null;
  }
}
