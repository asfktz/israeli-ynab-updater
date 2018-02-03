import inquirer from 'inquirer';

import { CONFIG_FOLDER, PASSWORD_FIELD } from './definitions';
import { SCRAPERS } from './helpers/scrapers';
import { writeJsonFile } from './helpers/files';
import { enryptCredentials } from './helpers/credentials';

function validateNonEmpty(field, input) {
  if (input) {
    return true;
  }
  return `${field} must be non empty`;
}

async function scraperSetup() {
  const scraperNameResult = await inquirer.prompt([{
    type: 'list',
    name: 'scraperName',
    message: 'Which scraper would you like to save credentials for?',
    choices: Object.keys(SCRAPERS).map((id) => {
      return {
        name: SCRAPERS[id].name,
        value: id,
      };
    }),
  }]);
  const { loginFields } = SCRAPERS[scraperNameResult.scraperName];
  const questions = loginFields.map((field) => {
    return {
      type: field === PASSWORD_FIELD ? PASSWORD_FIELD : 'input',
      name: field,
      message: `Enter value for ${field}:`,
      validate: input => validateNonEmpty(field, input),
    };
  });
  const credentialsResult = await inquirer.prompt(questions);
  const encryptedCredentials = enryptCredentials(credentialsResult);
  await writeJsonFile(`${CONFIG_FOLDER}/${scraperNameResult.scraperName}.json`, encryptedCredentials);
  console.log(`credentials file saved for ${scraperNameResult.scraperName}`);
}

async function fxSetup() {
  const { appID } = await inquirer.prompt({
    type: 'input',
    name: 'appID',
    message: 'Enter your openexchangerates.org app ID:',
  });

  const encryptedAppID = enryptCredentials({ appID });
  await writeJsonFile(`${CONFIG_FOLDER}/openexchangerates.json`, encryptedAppID);
  console.log('credentials file saved for openexchangerates.org');
}

export default async function () {
  const { next } = await inquirer.prompt({
    type: 'list',
    name: 'next',
    message: 'What would you like to setup?',
    choices: [
      {
        name: 'a new scraper',
        value: scraperSetup,
      },
      {
        name: 'openexchangerates.org',
        value: fxSetup,
      },
    ],
  });

  await next();
}
