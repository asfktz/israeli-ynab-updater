import oxr from 'oxr';
import moment from 'moment';
import { readJsonFile, writeJsonFile } from '../helpers/files';
import { all } from './async';

async function fetch(client, cache, dates) {
  const rates = await cache.read();

  await all(dates, async (rawDate) => {
    const date = moment(rawDate).format('YYYY-MM-DD');

    if (!rates[date]) {
      rates[date] = await oxr.historical(date);
    }

    return rates[date];
  });

  await cache.write(rates);

  return rates;
}

function cacheFactory(cachePath) {
  async function read() {
    const records = await readJsonFile(cachePath);
    return records || {};
  }

  async function write(records) {
    return writeJsonFile(cachePath, records);
  }

  return { read, write };
}

function factory({ cachePath, appId }) {
  const storage = cacheFactory(cachePath);
  const client = oxr.factory({ appId });

  return {
    fetch: (...args) => fetch(client, storage, ...args),
  };
}

export default { factory };
