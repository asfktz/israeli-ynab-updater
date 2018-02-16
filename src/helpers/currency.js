import currencyFormatter from 'currency-formatter';
import round from 'lodash/round';
import fx from 'money';

export function format(amount, code) {
  return currencyFormatter.format(amount, { code });
}

export default function convert(amount, rate, from, to) {
  fx.base = rate.base;
  fx.rates = rate.rates;

  const converted = fx.convert(amount, { from, to });
  return round(converted, 2);
}
