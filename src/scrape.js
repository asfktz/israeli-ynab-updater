import moment from 'moment';
import _ from 'lodash';
import json2csv from 'json2csv';
import inquirer from 'inquirer';

import { DOWNLOAD_FOLDER, CONFIG_FOLDER, SCRAPERS } from './definitions';
import { createScraper } from './helpers/scrapers';
import { tryCatch, all } from './helpers/async';
import * as currency from './helpers/currency';

import { writeFile, readEncrypted } from './helpers/files';
import Rates from './helpers/rates';

export default async function () {
  const { scraperName, combineInstallments } = await inquirer.prompt([
    {
      type: 'list',
      name: 'scraperName',
      message: 'Which bank would you like to scrape?',
      choices: Object.keys(SCRAPERS).map((id) => {
        return {
          name: SCRAPERS[id].name,
          value: id,
        };
      }),
    },
    {
      type: 'confirm',
      name: 'combineInstallments',
      message: 'Combine installment transactions?',
      default: true,
    },
  ]);

  const credentials = await readEncrypted(`${CONFIG_FOLDER}/${scraperName}.json`);

  if (!credentials) {
    console.log('Could not find credentials file');
    // TODO: ask 'would you like to set it now?'
    return;
  }

  const options = {
    companyId: scraperName,
    startDate: moment().startOf('month').subtract(4, 'month').toDate(),
    combineInstallments,
    verbose: false,
  };

  const scraper = createScraper(options);

  scraper.onProgress((companyId, payload) => {
    console.log(`${companyId}: ${payload.type}`);
  });

  const [scraperErr, result] = await tryCatch(scraper.scrape(credentials));

  if (scraperErr) {
    console.error(scraperErr);
    return;
  }

  if (!result.success) {
    console.log(`error type: ${result.errorType}`);
    console.log('error:', result.errorMessage);
    return;
  }

  console.log(`success: ${result.success}`);

  // TODO: PR this normalization logic to israeli-bank-scrapers
  const normalizeCurrency = currency => ((currency) === 'NIS' ? 'ILS' : currency);
  const accounts = _.map(result.accounts, account => ({
    ...account,
    txns: _.map(account.txns, (txn) => {
      const originalCurrency = normalizeCurrency(txn.originalCurrency);
      return { ...txn, originalCurrency };
    }),
  }));

  const ratesService = Rates.factory({
    appId: await readEncrypted(`${CONFIG_FOLDER}/openexchangerates.json`),
    cachePath: `${CONFIG_FOLDER}/rates.json`,
  });

  const extractDates = _.flow([
    accounts => _.flatMap(accounts, 'txns'),
    txns => _.reject(txns, { originalCurrency: 'ILS' }),
    txns => _.map(txns, 'date'),
    dates => _.uniq(dates),
  ]);

  const dates = extractDates(accounts);
  const rates = ratesService.fetch(dates);

  await all(accounts, (account) => {
    const txns = _.map(account.txns, (txn) => {
      const { originalCurrency, date } = txn;
      const isLocal = txn.originalCurrency === 'ILS';

      const inflow = txn.type !== 'installments' || !combineInstallments
        ? txn.chargedAmount
        : txn.originalAmount;

      return {
        Date: moment(date).format('DD/MM/YYYY'),
        Payee: txn.description,
        Inflow: isLocal ? inflow : currency.convert(inflow, rates[date], originalCurrency, 'ILS'),
        Installment: txn.installments ? txn.installments.number : null,
        Total: txn.installments ? txn.installments.total : null,
        Memo: isLocal ? '' : currency.format(inflow),
      };
    });

    const csv = json2csv({
      fields: ['Date', 'Payee', 'Inflow', 'Installment', 'Total', 'Memo'],
      data: txns,
      withBOM: true,
    });

    return writeFile(`${DOWNLOAD_FOLDER}/${scraperName} (${account.accountNumber}).csv`, csv);
  });

  console.log(`${result.accounts.length} csv files saved under ${DOWNLOAD_FOLDER}`);
}
