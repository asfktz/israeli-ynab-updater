import flatMap from 'lodash/flatMap';
import uniq from 'lodash/uniq';
import keyBy from 'lodash/keyBy';
import round from 'lodash/round';
import debounce from 'lodash/debounce';

import oxr from 'oxr';
import fx from 'money';
import moment from 'moment';

import { CONFIG_FOLDER, LOCAL_CURRENCY } from '../definitions';
import { readJsonFile, writeJsonFile } from '../helpers/files';

import { tryCatch } from '../helpers/utils';

const all = Promise.all.bind(Promise);

function asRateDate(date) {
  return moment(date).format('YYYY-MM-DD');
}

function selectCurrency(txn) {
  // Todo: normalize `NIS` to `ILS` in israeli-bank-scrapers
  if (txn.originalCurrency === 'NIS') {
    return 'ILS';
  }

  return txn.originalCurrency;
}

function getDates(accounts) {
  const txns = flatMap(accounts, 'txns');
  const dates = uniq(txns
    .filter(txn => selectCurrency(txn) !== LOCAL_CURRENCY)
    .map(txn => asRateDate(txn.date)));

  return dates;
}

const createConvertor = (rate, from, to) => (amount) => {
  if (!amount) return null;

  // Keep an eye on this one.
  // fx is a singleton, therefore changing its
  // "base" and "rates" properties here
  // will affect every other usage after that.
  fx.base = rate.base;
  fx.rates = rate.rates;

  const convertAmount = fx.convert(amount, { from, to });

  // As precaution, we'll reset those values immediately.
  fx.base = null;
  fx.rates = null;

  return round(convertAmount, 2);
};

function prepareTxn(txn, rates) {
  const currency = selectCurrency(txn);

  if (currency === LOCAL_CURRENCY) {
    return { ...txn, meta: { ...txn.meta, converted: false } };
  }

  const date = asRateDate(txn.date);
  const rate = rates[date];
  const convertFx = createConvertor(rate, currency, LOCAL_CURRENCY);

  return {
    ...txn,
    chargedAmount: convertFx(txn.chargedAmount),
    originalAmount: convertFx(txn.originalAmount),
    meta: {
      ...txn.meta,
      converted: true,
      original: {
        originalCurrency: txn.originalCurrency,
        chargedAmount: txn.chargedAmount,
        originalAmount: txn.originalAmount,
      },
    },
  };
}


export default async function convert(accounts, appId) {
  const oxr = rates.createClient({
    appId,
    cachePath: `${CONFIG_FOLDER}/rates.json`,
  });

  const dates = await getDates(accounts);
  const rates = await all(dates.map(date => oxr.historical(date)));

  return accounts.map((account) => {
    const txns = account.txns.map(txn => prepareTxn(txn, rates));
    return { ...account, txns };
  });
}
