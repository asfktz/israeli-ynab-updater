import oxr from 'oxr';

const save = debounce((cachePath, rates) => writeJsonFile(cachePath, rates), 500);

export await function createClient (appId, cachePath) {
  const service = oxr.factory({ appId });
  const rates = await readJsonFile(cachePath);

  return oxr.cache({
    method: 'historical',
    store: {
      get: (date) => {
        return rates[date];
      },
      put: (value, date) => {
        rates[date] = value;
        save(cachePath, rates);
      },
    },
  }, service);
}