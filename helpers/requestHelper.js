import fetch from 'node-fetch';
import https from 'https';
import http from 'http';
import { checkFileExist } from '../utils/fileUtils';

const FormData = require('form-data');

let fs = require('fs');

const getAgent = (url) => {
  if (url.includes('https')) {
    return https.Agent({
      rejectUnauthorized: false,
    });
  } else {
    return http.Agent({
      rejectUnauthorized: false,
    });
  }
};


export async function get(url, token = null, timeout) {
  const agent = getAgent(url);
  try {
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const options = { headers, agent };
    if (timeout) options.timeout = timeout;
    const result = await fetch(url, options);
    return result.json();
  } catch (e) {
    return null;
  }
}

export async function put(url, token = null, body) {
  const agent = getAgent(url);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    body = JSON.stringify(body) || '';
    const opt = { method: 'PUT', headers, agent, body };
    const result = await fetch(url, opt);
    return result.json();
  } catch (e) {
    return null;
  }
}

export async function postFile(url, filePath) {
  try {
    const agent = getAgent(url);
    let file = fs.createReadStream(filePath);
    const data = new FormData();
    data.append('file', file);
    const opt = { method: 'POST', body: data, agent };
    const result = await fetch(url, opt);
    return await result.json();
  } catch (e) {
    console.log(e);
    return null;
  }
}

export async function post(url, body) {
  try {
    const agent = getAgent(url);
    const opt = { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, agent };
    const result = await fetch(url, opt);
    return await result.json();
  } catch (e) {
    console.log(e);
    return null;
  }
}


export async function syncImageAi(url, filePath, userId, token = null) {
  try {
    const agent = getAgent(url);
    let file = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('id_user', userId);
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const opt = { method: 'POST', body: formData, agent, headers };
    const result = await fetch(url, opt);
    return await result.json();
  } catch (e) {
    console.log(e);
    return null;
  }
}
