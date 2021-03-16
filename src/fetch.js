import nodeFetch from 'node-fetch';
import dayjs from 'dayjs';
import chalk from 'chalk';
import jsdom from 'jsdom';
import punycode from 'punycode';
import mapLimit from 'async/mapLimit.js';
import fetchRetry from 'fetch-retry';
import { diffArrayUnordered, mapReduceToObj, arrayPrototypeUnique,
  _assert } from './utils.js';
const fetch = fetchRetry(nodeFetch); // 3 retries, 1000ms delays
const { JSDOM } = jsdom;
Array.prototype.unique = arrayPrototypeUnique;


// For future reference, here are some sources of information we passed over
//
// https://data.iana.org/TLD/tlds-alpha-by-domain.txt
// Root zone directly seemed to be a more accurate place to grab
//
// https://newgtlds.icann.org/en/program-status/delegated-strings
// We are not interested in things that haven't hit the zonefiles yet because
// we're concerned with registerability
//
// https://www.icann.org/resources/registries/gtlds/v2/gtlds.json
// Not much extra info here, even though it's nicely formatter...
//
// https://www.icann.org/resources/pages/listing-2012-02-25-en
// Seems to mostly duplicat the IANA database
//
// https://www.icann.org/resources/registries/gtlds/v1/newgtlds.csv
// Has delegation date, application Id, and signing date got gTLD

/**
 * Queries DNS root zone for all TLD strings from
 * http://www.internic.net/domain/root.zone
 * (most accurate on what's currently active but no categorical info or anything)
 * @returns {String[]} Array of all strings from the root zone. Punycode domains
 * (xn--) are decoded to unicode
 */
export async function getTLDsFromRootZone() {
  process.stderr.write('Fetching...\n');
  const resp = await fetch('http://www.internic.net/domain/root.zone');
  if (!resp.ok) {
    console.error(resp);
    throw new Error(`Fetch failed with '${resp.statusCode} ${resp.statusMessage}'`);
  }
  const text = await resp.text();

  process.stderr.write('\rParsing...\n');
  return text.split('\n')
    // Get up to first whitespace (the xxx.yyy.zzz. portion)
    .map(s => s.slice(0, s.search(/\s/)))
    // For TLDs, the first '.' will be at the end of the string, filter out the rest
    .filter(s => s.indexOf('.') === s.length - 1)
    .map(s => s.slice(0,-1))
    .filter(s => !!s)
    .map(s => s.startsWith('xn--') ? punycode.decode(s.slice(4)) : s)
    .unique();
}

/**
 * Scrape the data off of IANAs DB
 * It should be relatively stable as multiple projects refer to it as a source
 * and scrape t that I've seen
 * https://www.iana.org/domains/root/db
 *
 * TLDs on here might not be in the root DNS yet or might have been terminated.
 * Keep that in mind when using this dataset...
 * More info on termination:
 * https://www.icann.org/resources/pages/gtld-registry-agreement-termination-2015-10-09-en
 *
 * @returns {Object[]} Array with all found tlds. Contains:
 * * `.tld` - TLD string, already decoded from punycode
 * * `.type` - The ICANN type (see https://icannwiki.org/Generic_top-level_domain).
 *     ['generic', 'country-code', 'sponsored', 'infrastructure', etc...]
 * * `.sponsor` - The sponsoring organization
 */
export async function getTLDInfoFromIANADB() {
  process.stderr.write('Fetching...\n');
  const resp = await fetch('https://www.iana.org/domains/root/db');
  if (!resp.ok) {
    console.error(resp);
    throw new Error(`Fetch failed with '${resp.statusCode} ${resp.statusMessage}'`);
  }
  const text = await resp.text();

  process.stderr.write('Parsing...\n');
  const dom = new JSDOM(text);
  return Array.from(dom.window.document.querySelectorAll('#tld-table tbody tr'))
    .map(tr => Array.from(tr.children).map(td => td.textContent.trim()))
    .map(([tld, type, sponsor]) => {
      return {
        // Remove leading '.' and any Unicode LTR/RTL marks
        tld: tld.trim().replace(/[.\u200F\u200E]/g, ''),
        // Info on types: https://icannwiki.org/Generic_top-level_domain
        type: type.trim(), //'generic', 'country-code', 'sponsored', 'infrastructure', etc...
        sponsor: sponsor.trim()
      };
    });
}

/**
 * Scrapes the given ICANN registry agreement for a _gTLD_. This contains the
 * best public source of truth for how a certain TLD/registry will handle it's
 * data.
 * All agreements can be found:
 * https://www.icann.org/resources/pages/registries/registries-agreements-en
 * and the tabs at the top (terminated and archived) even have other types of TLDs
 *
 * Note: This Can't handle original TLDs, ccTLD, sTLDs, as they don't have enough
 * similarity in their registry agreement/page structure to make an auto search
 * like this useful
 * Note: Specification 12 and 13 are not _always_ the places checked for below.
 * Specification 13 is _normally_ found on the registry agreement page as a separate
 * document. Specification 12 _normally_ is added for registration restrictions.
 * But there are outliers. For example, `.law` adds its registration restrictions
 * in a separate ammendment to it's agreement in a separate PDF document, and even
 * then it's added to the end of Exhibit A instead of Specification 12. Also, sometimes
 * it seems like registries might only put this information in terms of use/
 * acceptable use policy (wikipedia quotes this for restrictions on .lgbt).
 * This is just a real quick check most gTLDs follow. It can be made better.
 * @returns {object}
 * * `.hasSpec13` - Does the registry agreement include Specification 13. This means
 *     the TLD is a generic brand TLD and is meant exclusively for the company that's
 *     registering. Brand TLDs will not always include this! because ICANN :shrug:?
 * * `.hasSpec12` - The Specification that's commonly added to the registry agreement
 *     to specify registration restrictions.
 * * `.hasSpec9Exemption` - Whether the gTLD has an active exemption to specification
 *     9 and it has not been withdrawal. Specification 9 exemption is very similar
 *     to a Specification 13 addition. The last bullet at specification 9 basically
 *     specifies it is a TLD only meant for registry and affiliates.
 */
export async function gTLDInfoFromRegistryAgreement(gTLD) {
  process.stderr.write(`Fetching gTLD registry agreement page for ${gTLD}\n`);
  const resp = await fetch(`https://www.icann.org/en/about/agreements/registries/${gTLD}`);
  if (!resp.ok) {
    console.error(resp);
    throw new Error(`Fetch for '${gTLD}' failed with '${resp.statusCode} ${resp.statusMessage}'`);
  }
  const text = await resp.text();

  process.stderr.write(`Parsing gTLD registry agreement page for ${gTLD}\n`);
  const dom = new JSDOM(text);
  if (!dom.window.document.querySelector('#agmthtml a')) {
    console.log('Dumping dom in weird error case');
    console.log(dom);
  }
  _assert(dom.window.document.querySelector('#agmthtml a'), `'#agmthtml a' on ${gTLD} should be present`);

  const hasSpec13 = !!dom.window.document.querySelector('#spec13');
  const hasSpec9Exemption = !!dom.window.document.querySelector('#spec9') &&
    !dom.window.document.querySelector('#spec9').textContent.match(/withdrawal/i);

  // It's a relative href to site root
  const baseRegistryAgreementHTMLHref = dom.window.document.querySelector('#agmthtml a')
    .getAttribute('href');

  process.stderr.write(`Fetching gTLD registry agreement HTML for ${gTLD}\n`);
  const resp2 = await fetch(`https://www.icann.org${baseRegistryAgreementHTMLHref}`);
  if (!resp2.ok) {
    console.error(resp2);
    throw new Error(`Fetch2 for '${gTLD}' failed with '${resp2.statusCode} ${resp2.statusMessage}'`);
  }
  const text2 = await resp2.text();

  const hasSpec12 = text2.includes("SPECIFICATION 12");

  return { hasSpec13, hasSpec12, hasSpec9Exemption };
}

/**
 * Retrieves all sunrise/sunset data from the export on
 * https://newgtlds.icann.org/en/program-status/sunrise-claims-periods
 * Only available for gTLDs
 * @returns {Object[]} Array of objects, one per TLD, defining the periods and dates
 * for the TLD
 * ```
 * .tld - The tld, decoded from punycode to Unicode
 * .spec13 - If it was a spec13 (brand) TLD in this dataset
 * .periods - Array of period objects. Should have at least 'Sunrise' and 'Trademark Claims'
 *   .periods.name - Name of the period
 *   .periods.open - Open date of the period (might be omitted)
 *   .periods.close - Close date of the period (might be omitted)
 *   .periods.type - For "other periods", the string in the type field (might be omitted)
 * .isNotGenerallyAvailable - If the TLD is NOT in General Availability, therefore not registerable (NOTE: NOT ACCURATE)
 * ```
 */
export async function getTLDsWithStatusPeriods() {
  process.stderr.write(`Fetching gTLD sunrise, sunset data\n`);
  const resp = await fetch('https://newgtlds.icann.org/program-status/sunrise-claims-periods.xls');
  if (!resp.ok) {
    console.error(resp);
    throw new Error(`Fetch failed with '${resp.statusCode} ${resp.statusMessage}'`);
  }
  const text = await resp.text();

  process.stderr.write(`Parsing gTLD sunrise, sunset data\n`);
  // So ironically... this is not an .xls file (even though the site says so?) but
  // an HTML table... So that's cool and easier to parse.
  const dom = new JSDOM(text);
  const ret = Array.from(dom.window.document.querySelectorAll('tbody tr'))
    .map(tr => Array.from(tr.children).map(td => td.textContent.trim()))
    .map((rows) => {
      const [tld, type, sunriseOpenDate, sunriseCloseDate, trademarkClaimsOpenDate,
        trademarkClaimsCloseDate, otherPeriodFrom, otherPeriodName, otherPeriodTo, otherPeriodType,
        lastUpdated] = rows;

      // Defines the type of sunrise the registry has
      // https://en.wikipedia.org/wiki/Sunrise_period
      const types = ['Start Date Sunrise', 'End Date Sunrise', 'Spec 13 - .BRAND TLD']
      _assert(type === '' || types.includes(type.trim()), `'${tld}' sunrise event type must be in well-known types or blank`);

      // Parse all the period information
      // Other periods are CSV'd (if there are any)
      function makePeriod(name, open, close, type) {
        _assert(name, 'No period name given');
        if (!open && !close) {
          return [];
        }

        return [{
          name,
          ...(open ? { open: dayjs(open, 'D MMM YYYY', true) } : {} ),
          ...(close ? { close: dayjs(close, 'D MMM YYYY', true) } : {} ),
          ...(type ? { type } : {} ),
        }];
      }

      let otherPeriods = [];
      if (otherPeriodName !== '') {
        otherPeriods = otherPeriodFrom.split(',')
          // TODO: If there's ',' in the name field or type field, it doesn't necessarily work
          // well...
          .map((from, idx) => makePeriod(otherPeriodName.split(',')[idx].trim(), from.trim(),
            otherPeriodTo.split(',')[idx].trim(), otherPeriodType.split(',')[idx].trim()))
          .flat();
      }

      const periods = [
        ...makePeriod('Sunrise', sunriseOpenDate, sunriseCloseDate),
        ...makePeriod('Trademark Claims', trademarkClaimsOpenDate, trademarkClaimsCloseDate),
        ...otherPeriods
      ];

      // General Availability...
      // There's no good way to get this data, I assume you have to be talking
      // to the registrars to know when the real date is...
      // Here's some guesses
      // 1) Use the last date in the periods that isn't "Trademark Claims"
      // Delegated -> Sunrise -> Landrush -> General Availability
      // 2) Use 90 days before the end of "Trademark Claims" (ICANN requires 90 days of
      // trademark claims at least from General Availability launch:
      // https://www.trademark-clearinghouse.com/help/faq/how-will-trademark-claims-service-function
      // Neither of these are super accurate from checking. Sometimes #1 can be
      // off by years (e.g. .homes) and I've seen #2 off by at least 2 months...
      // So we just choose a safe bet (guess 1) as there's more likely to be at
      // least 1 close date
      const generalAvailabilityGuess1 = periods
        .filter(p => p.name !== 'Trademark Claims')
        .map(p => p.close)
        .filter(d => !!d)
        // Find highest
        .reduce((acc, itm) => {
          if (acc === undefined) {
            return itm;
          }
          return acc.isAfter(itm) ? acc : itm;
        }, undefined);
      //const generalAvailabilityGuess2 = Date.parse(trademarkClaimsCloseDate) - (90 * 24 * 60 * 60 * 1000); //NaN if date fails to parse
      // undefined === No .close date specified
      const isNotGenerallyAvailable = generalAvailabilityGuess1 === undefined ?
        true : generalAvailabilityGuess1.isAfter(dayjs());

      // Convert periods to the output objects (no dayjs())
      const outPeriods = periods.slice()
        .map(p => {
          const ret = Object.assign({}, p);
          if (ret.open) {
            ret.open = ret.open.format('YYYY-MM-DD')
          }
          if (ret.close) {
            ret.close = ret.close.format('YYYY-MM-DD')
          }
          return ret;
        });

      return {
        tld: punycode.toUnicode(tld),
        spec13: type.trim() === 'Spec 13 - .BRAND TLD',
        periods: outPeriods,
        isNotGenerallyAvailable
      };
    })
    .filter(o => !!o);

  _assert(ret.length === ret.unique().length, 'All TLDs should appear once in sunrise/sunset data')
  return ret;
}

/**
 * Retrieve all the TLD data
 * @param {Object} Object of tlds mapped to objects to use for the manual data
 * step
 * @returns {object[]}
 * * `.tld` - TLD string
 * * `.type` - The type of TLD (see `getTLDInfoFromIANADB()`)
 * * `.isBrand` - If present, is a brand TLD (only .type generic will have)
 * * `.hasRestrictions` - If present, the TLD has restrictions for registering
 */
export async function getTLDData(prevData) {
  // == 1. Download the root zone and get all TLDs ==
  process.stderr.write(chalk.bgWhite.black('== TLDs from root zone ==\n'));
  const rootZoneTLDStrs = await getTLDsFromRootZone();
  let tlds = rootZoneTLDStrs
    .map(s => ({
      tld: s
    }));
  process.stderr.write(`Found TLDs: ${chalk.yellow(tlds.length)}\n`);

  // == 2. Load in categorical info from IANA DB ==
  process.stderr.write(chalk.bgWhite.black('== TLDs and categories from IANA Root DB ==\n'));
  const ianaDBTLDs = await getTLDInfoFromIANADB();
  process.stderr.write(`* Found TLDs: ${chalk.yellow(ianaDBTLDs.length)}\n`);
  const prettyTypes = ianaDBTLDs
    .map(o => o.type)
    .unique()
    .map(c => chalk.yellow(c))
    .join(', ');
  process.stderr.write(`* Found types: ${prettyTypes}\n`);
  const diffWithRootZone = diffArrayUnordered(ianaDBTLDs.map(o => o.tld), rootZoneTLDStrs);
  process.stderr.write(`* Diff with root zone: ${diffWithRootZone}\n`);
  process.stderr.write('(note): TLDs might be in this source but not in the root zone if the TLD is delegated but not in DNS or if the registry service has been terminated\n');

  // Combine using previous data, but use root zone as source of truth
  process.stderr.write('Combining with previous data\n');
  tlds.forEach(t => {
    const ianaDBTLD = ianaDBTLDs.find(o2 => t.tld === o2.tld);
    // IANA data should be exhaustive and define all TLDs in the root zone
    _assert(ianaDBTLD, `'${t.tld}' must exist in the IANA DB but it didn't`);

    t.type = ianaDBTLD.type;
  });
  process.stderr.write('Combined\n');

  // == 3. Load in period/sunrise/sunset data ==
  process.stderr.write(chalk.bgWhite.black('== gTLDs with status periods ==\n'));
  const sunriseSunsetTLDs = await getTLDsWithStatusPeriods();
  process.stderr.write(`* Found gTLDs: ${chalk.yellow(sunriseSunsetTLDs.length)}\n`);
  const prettyTLDsWithNoStatus = tlds
    .filter(t => t.type === 'generic')
    .filter(t => !['com', 'info', 'net', 'org', 'mobi'].includes(t.tld))
    .filter(t => !sunriseSunsetTLDs.find(o => o.tld === t.tld))
    .map(t => chalk.yellow(t.tld))
    .join(', ');
  process.stderr.write(`* gTLDs with no status: ${prettyTLDsWithNoStatus}\n`);
  const prettyTLDsWithNotPast = sunriseSunsetTLDs
    .filter(o => o.isNotGenerallyAvailable)
    .map(o => o.spec13 ? `*${chalk.gray(o.tld)}` : chalk.yellow(o.tld))
    .join(', ');
  process.stderr.write(`* gTLDs which haven't hit General Availability yet (*${chalk.gray('has spec 13')}): ${prettyTLDsWithNotPast}\n`);

  process.stderr.write('Combining with previous data\n');
  tlds
    .filter(t => t.type === 'generic')
    .filter(t => !['com', 'info', 'net', 'org', 'mobi'].includes(t.tld))
    .forEach(t => {
      const o = sunriseSunsetTLDs.find(o => o.tld === t.tld);
      if (!o) {
        // If not found, then it's not available
        t.isNotInGeneralAvailability = false;
        return;
      }

      t.periods = o.periods;
      t.isNotInGeneralAvailability = o.isNotGenerallyAvailable;
    });
  process.stderr.write('Combined\n');

  // == 4. Brand TLD & TLD restrictions ==
  process.stderr.write(chalk.bgWhite.black('== TLD information from registry agreements ==\n'));
  // This is data for which we don't have automation
  const manualData = {
    // generic
    ...mapReduceToObj(
      ['com', 'info', 'net', 'org', 'mobi'],
      {}),

    // sponsorted (sTLD)
    ...mapReduceToObj(
      ['aero', 'asia', 'cat', 'coop', 'edu', 'gov', 'int', 'jobs', 'mil', 'museum', 'post', 'tel', 'travel', 'xxx'],
      { isBrand: false, hasRestrictions: true }),

    // generic-restricted
    ...mapReduceToObj(
      ['biz', 'name', 'pro'],
      { isBrand: false, hasRestrictions: true }),

    // infrastructure
    arpa: { isBrand: false, hasRestrictions: true },

    // Anything from the outside
    ...prevData
  };

  await mapLimit(tlds, 5, async o => {
    if(manualData[o.tld]) {
      Object.assign(o, manualData[o.tld]);
      return;
    }
    // All gTLDs are marked 'generic', but also includes some that aren't new gTLDs
    // like .com and .net, which the if clause above should solve
    else if(o.type === 'generic') {
      await new Promise((resolve) => resolve());
      const asciiTLD = punycode.toASCII(o.tld);
      const info = await gTLDInfoFromRegistryAgreement(asciiTLD);
      process.stderr.write(`Got data for ${asciiTLD}, ${JSON.stringify(info)}\n`);
      Object.assign(o, {
        isBrand: info.hasSpec13 || info.hasSpec9Exemption,
        hasRestrictions: info.hasSpec12,
      });
      return;
    }
  });

  return tlds;
}
