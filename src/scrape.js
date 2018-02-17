import moment from 'moment';
import json2csv from 'json2csv';
import inquirer from 'inquirer';
import all from 'promise-all-map';
import { flow, flatMap, reject, map, uniq } from 'lodash';
import { DOWNLOAD_FOLDER, CONFIG_FOLDER } from './definitions';
import { createScraper, SCRAPERS } from './helpers/scrapers';
import { tryCatch } from './helpers/async';
import * as currency from './helpers/currency';
import { writeFile, readEncrypted } from './helpers/files';
import * as Rates from './helpers/rates';

async function getParameters() {
  const result = await inquirer.prompt([
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
  return result;
}

export default async function () {
  const { scraperName, combineInstallments } = await getParameters();

  const credentials = await all({
    scraper: readEncrypted(`${CONFIG_FOLDER}/${scraperName}.json`),
    oxr: readEncrypted(`${CONFIG_FOLDER}/openexchangerates.json`),
  });

  if (!credentials.scraper) {
    console.log(`Could not find credentials file for ${scraperName}`);
    // TODO: ask 'would you like to set it now?'
    return;
  }

  if (!credentials.oxr) {
    console.log('Could not find credentials file for openexchangerates.org');
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

  const [scraperErr, result] = await tryCatch(scraper.scrape(credentials.scraper));

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


  // Todo: Remove this block of code
  // after israeli-bank-scrapers/pull/77 will be merged.
  const normalizeCurrency = currency => ((currency) === 'NIS' ? 'ILS' : currency);
  const accounts = map(result.accounts, account => ({
    ...account,
    txns: map(account.txns, (txn) => {
      return {
        ...txn,
        originalCurrency: normalizeCurrency(txn.originalCurrency),
      };
    }),
  }));

  const ratesService = Rates.factory({
    appId: credentials.oxr.appId,
    cachePath: `${CONFIG_FOLDER}/rates.json`,
  });

  const extractDates = flow([
    accounts => flatMap(accounts, 'txns'),
    txns => reject(txns, { originalCurrency: 'ILS' }),
    txns => map(txns, 'date'),
    dates => uniq(dates),
  ]);

  const dates = extractDates(accounts);
  const rates = await ratesService.fetch(dates);

  const files = await accounts.map((account) => {
    const { accountNumber } = account;

    const txns = account.txns.map((txn) => {
      const { originalCurrency, date } = txn;
      const isLocal = txn.originalCurrency === 'ILS';

      const inflow = txn.type !== 'installments' || !combineInstallments
        ? txn.chargedAmount
        : txn.originalAmount;

      const rate = Rates.select(rates, date);

      return {
        Date: moment(date).format('DD/MM/YYYY'),
        Payee: txn.description,
        Inflow: isLocal ? inflow : currency.convert(inflow, rate, originalCurrency, 'ILS'),
        Installment: txn.installments ? txn.installments.number : null,
        Total: txn.installments ? txn.installments.total : null,
        Memo: isLocal ? '' : currency.format(inflow, originalCurrency),
      };
    });

    return { accountNumber, txns };
  });

  await all(files, ({ accountNumber, txns }) => {
    const filepath = `${DOWNLOAD_FOLDER}/${scraperName} (${accountNumber})`;
    const contents = json2csv({
      fields: ['Date', 'Payee', 'Inflow', 'Installment', 'Total', 'Memo'],
      data: txns,
      withBOM: true,
    });

    return writeFile(filepath, contents);
  });

  console.log(`${result.accounts.length} csv files saved under ${DOWNLOAD_FOLDER}`);
}
