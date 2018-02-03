import moment from 'moment';
import inquirer from 'inquirer';
import json2csv from 'json2csv';
import currencyFormatter from 'currency-formatter';

import { CONFIG_FOLDER, DOWNLOAD_FOLDER } from './definitions';
import { writeFile, readJsonFile } from './helpers/files';
import { decryptCredentials } from './helpers/credentials';
import { SCRAPERS, createScraper } from './helpers/scrapers';
import convert from './helpers/convert';
import { tryCatch } from './helpers/utils';


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

const selectInflow = (type, combineInstallments, chargedAmount, originalAmount) => {
  return type !== 'installments' || !combineInstallments
    ? chargedAmount
    : originalAmount;
};

function createMemo(txn, combineInstallments) {
  if (!txn.meta.converted) {
    return '';
  }

  const { original } = txn.meta;

  const originalInflow = selectInflow(
    txn.type,
    combineInstallments,
    original.chargedAmount,
    original.originalAmount,
  );

  return currencyFormatter.format(originalInflow, { code: original.originalCurrency });
}

async function exportAccountData(scraperName, account, combineInstallments) {
  console.log(`exporting ${account.txns.length} transactions for account # ${account.accountNumber}`);

  const txns = account.txns.map((txn) => {
    const inflow = selectInflow(
      txn.type,
      combineInstallments,
      txn.chargedAmount,
      txn.originalAmount,
    );

    return {
      Date: moment(txn.date).format('DD/MM/YYYY'),
      Payee: txn.description,
      Inflow: inflow,
      Installment: txn.installments ? txn.installments.number : null,
      Total: txn.installments ? txn.installments.total : null,
      Memo: createMemo(txn, combineInstallments),
    };
  });
  const fields = ['Date', 'Payee', 'Inflow', 'Installment', 'Total', 'Memo'];
  const csv = json2csv({ data: txns, fields, withBOM: true });
  await writeFile(`${DOWNLOAD_FOLDER}/${scraperName} (${account.accountNumber}).csv`, csv);
}

async function readEncrypted(filename) {
  const encryptedCredentials = await readJsonFile(`${CONFIG_FOLDER}/${filename}.json`);

  return (encryptedCredentials)
    ? decryptCredentials(encryptedCredentials)
    : null;
}

export default async function () {
  const { scraperName, combineInstallments } = await getParameters();
  // const scraperName = 'leumiCard';
  // const combineInstallments = false;
  const credentials = await readEncrypted(scraperName);

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
  // const [scraperErr, result] = await tryCatch(readJsonFile(`./src/data/${scraperName}.json`));

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

  const fxCredentials = await readEncrypted('openexchangerates');

  if (!fxCredentials) {
    console.log('Could not find openexchangerates\'s app ID');
    // TODO: ask 'would you like to set it now?'
    return;
  }

  const [convertError, accounts] = await tryCatch(convert(result.accounts, fxCredentials.appID));

  if (convertError) {
    console.error(convertError);
    return;
  }

  const exports = accounts.map((account) => {
    return exportAccountData(scraperName, account, combineInstallments);
  });

  await Promise.all(exports);

  console.log(`${result.accounts.length} csv files saved under ${DOWNLOAD_FOLDER}`);
}
