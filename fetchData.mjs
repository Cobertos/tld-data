import { promisify } from 'util';
import fetch from 'node-fetch';
import chalk from 'chalk';
import jsdom from 'jsdom';
import punycode from 'punycode';
import mapLimit from 'async/mapLimit.js';
const { JSDOM } = jsdom;

// For future reference, here are some sources of information we passed over
//
// CSV export from https://newgtlds.icann.org/en/program-status/sunrise-claims-periods
// It's kept up to date and has some useful info, but it looks like the registry agreemenets are better
// for determining the information in here wrt restrictions
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

function diffArrayUnordered(actual, expected) {
  // In actual but not expected
  return actual
    .filter(i => !expected.includes(i))
    .map(i => `+${chalk.green(i)}`)
    .join(', ') + '; ' +
  // In expected by not actual
  expected
    .filter(i => !actual.includes(i))
    .map(i => `-${chalk.red(i)}`)
    .join(', ');
}

function mapReduceToObj(arr, obj) {
  return arr
    .map(_ => ({ [_]: obj }))
    .reduce(Object.assign, {});
}

Array.prototype.unique = function() {
  return Array.from(new Set(this));
};

/**
 * Queries DNS root zone for all TLD strings from
 * http://www.internic.net/domain/root.zone
 * (most accurate on what's currently active but no categorical info or anything)
 * @returns {String[]} Array of all strings from the root zone. Punycode domains
 * (xn--) are decoded to unicode
 */
async function getTLDsFromRootZone() {
  process.stderr.write('Fetching...\n');
  const resp = await fetch('http://www.internic.net/domain/root.zone');
  const text = await resp.text();

  process.stderr.write('\rParsing...\n');
  return text.split('\n')
    // Get up to first whitespace (the xxx.yyy.zzz. portion)
    .map(s => s.slice(0, s.search(/\s/)))
    // The only '.' for TLDs will be at the end, filter out rest
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
async function getTLDInfoFromIANADB() {
  // == 2. Load in categorical info ==
  process.stderr.write(chalk.bgWhite.black('== TLDs and categories from IANA Root DB ==\n'));
  process.stderr.write('Fetching...\n');
  const resp2 = await fetch('https://www.iana.org/domains/root/db');
  const text2 = await resp2.text();

  process.stderr.write('Parsing...\n');
  const dom = new JSDOM(text2);
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
 */
async function gTLDInfoFromRegistryAgreement(gTLD) {
  process.stderr.write(`Fetching gTLD registry agreement page for ${gTLD}\n`);
  const resp = await fetch(`https://www.icann.org/en/about/agreements/registries/${gTLD}`);
  const text = await resp.text();

  process.stderr.write(`Parsing gTLD registry agreement page for ${gTLD}\n`);
  const dom = new JSDOM(text);
  const hasSpec13 = !!dom.window.document.querySelector('#spec13');

  // It's a relative href to site root
  const baseRegistryAgreementHTMLHref = dom.window.document.querySelector('#agmthtml a')
    .getAttribute('href');

  process.stderr.write(`Fetching gTLD registry agreement HTML for ${gTLD}\n`);
  const resp2 = await fetch(`https://www.icann.org${baseRegistryAgreementHTMLHref}`);
  const text2 = await resp2.text();

  const hasSpec12 = text2.includes("SPECIFICATION 12");

  return { hasSpec13, hasSpec12 };
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
async function getTLDData(prevData) {
  // == 1. Download the root zone and get all TLDs ==
  process.stderr.write(chalk.bgWhite.black('== TLDs from root zone ==\n'));
  const rootZoneTLDStrs = await getTLDsFromRootZone();
  let tlds = rootZoneTLDStrs
    .map(s => ({
      tld: s
    }));
  process.stderr.write(`Found TLDs: ${chalk.yellow(tlds.length)}\n`);

  // == 2. Load in categorical info from IANA DB ==
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
  tlds.forEach(o => {
    // If this fails, the TLD in the root zone had no type information, which
    // shouldn't happen. The list should be exhaustive
    o.type = ianaDBTLDs.find(o2 => o.tld === o2.tld).type;
  })
  process.stderr.write('Combined\n');

  // == 3. Brand TLD & TLD restrictions ==
  process.stderr.write(chalk.bgWhite.black('== TLD information from registry agreements ==\n'));
  // This is data for which we don't have automation
  const manualData = {
    // generic
    ...mapReduceToObj(
      ['com', 'info', 'net', 'org'],
      {}),

    // sponsorted (sTLD)
    ...mapReduceToObj(
      ['aero', 'asia', 'cat', 'coop', 'edu', 'gov', 'int', 'jobs', 'mil', 'mobi', 'tel', 'travel', 'xxx'],
      { isBrand: false, hasRestrictions: true }),

    // generic
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
        isBrand: info.hasSpec13,
        hasRestrictions: info.hasSpec12
      });
      return;
    }
  });

  return tlds;
}

// Reads full buffer out of stream
async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk); 
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  // Check stdin for any previous data
  const inStr = await read(process.stdin);
  let prevData;
  if(inStr) {
    const inObj = JSON.parse(inStr);
    prevData = inObj
      .map(({tld, isBrand, hasRestrictions}) => {
        return {
          [tld]: { isBrand, hasRestrictions }
        };
      })
      .reduce(Object.assign, {});
  }
  const tldObjs = await getTLDData(prevData);
  // Output
  process.stdout.write(JSON.stringify(tldObjs, null, 2));
}
main();