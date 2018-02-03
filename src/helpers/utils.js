
// eslint-disable-next-line import/prefer-default-export
export async function tryCatch(promise) {
  let response;

  try {
    response = await promise;
  } catch (err) {
    return [err];
  }

  return [null, response];
}
