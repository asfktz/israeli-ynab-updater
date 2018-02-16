import map from 'lodash/map';
import identity from 'lodash/identity';

export function all(iterable, mapper = identity) {
  return Promise.all(map(iterable, mapper));
}

export async function tryCatch(promise) {
  let response;

  try {
    response = await promise;
  } catch (err) {
    return [err];
  }

  return [null, response];
}
