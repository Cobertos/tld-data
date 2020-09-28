import { promisify } from 'util';
import { readFile } from 'fs';
import fetch from 'node-fetch';
import chalk from 'chalk';
import jsdom from 'jsdom';
import punycode from 'punycode';
import mapLimit from 'async/mapLimit.js';
import concordance from 'concordance';
const { JSDOM } = jsdom;
const readFileAsync = promisify(readFile);

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

function diffToStr(actual, expected) {
  const actualDescriptor = concordance.describe(actual);
  const expectedDescriptor = concordance.describe(expected);
  return concordance.diffDescriptors(actualDescriptor, expectedDescriptor);
  // const equal = concordance.compareDescriptors(actualDescriptor, expectedDescriptor);
  // if(equal) {
  //   return '-- No Differences --';
  // }
}

Array.prototype.unique = function() {
  return Array.from(new Set(this));
};

const heading = chalk.bgWhite.black;

(async function(){
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


// == 1. Download the root zone and get all TLDs ==
// http://www.internic.net/domain/root.zone (most accurate, but no categorical info)
console.log(heading('== TLDs from root zone =='));
console.log('Fetching...');
const resp = await fetch('http://www.internic.net/domain/root.zone');
const text = await resp.text();

console.log('Parsing...');
const rootZoneTLDStrs = text.split('\n')
  // Get up to first whitespace (the xxx.yyy.zzz. portion)
  .map(s => s.slice(0, s.search(/\s/)))
  // The only '.' for TLDs will be at the end, filter out rest
  .filter(s => s.indexOf('.') === s.length - 1)
  .map(s => s.slice(0,-1))
  .filter(s => !!s)
  .map(s => s.startsWith('xn--') ? punycode.decode(s.slice(4)) : s)
  .unique();
let tlds = rootZoneTLDStrs
  .map(s => ({
    tld: s
  }));
console.log(`Found TLDs: ${chalk.yellow(tlds.length)}`);

// == 2. Load in categorical info ==
// Everyone scrapes this (multiple project refer to it) so it should be stable
// https://www.iana.org/domains/root/db
console.log(heading('== TLDs and categories from IANA Root DB =='));
console.log('Fetching...');
const resp2 = await fetch('https://www.iana.org/domains/root/db');
const text2 = await resp2.text();

console.log('Parsing...');
const dom = new JSDOM(text2);
const ianaDBTLDs = Array.from(dom.window.document.querySelectorAll('#tld-table tbody tr'))
  .map(tr => Array.from(tr.children).map(td => td.textContent.trim()))
  .map(trArray => {
    return {
      // Remove leading '.' and any Unicode LTR/RTL marks
      tld: trArray[0].trim().replace(/[.\u200F\u200E]/g, ''),
      category: trArray[1].trim(), //'generic', 'country-code', 'sponsored', 'infrastructure', etc...
    };
  });
console.log(`* Found TLDs: ${chalk.yellow(ianaDBTLDs.length)}`);
//Info on categories: https://icannwiki.org/Generic_top-level_domain
const categories = ianaDBTLDs
  .map(o => o.category)
  .unique();
const prettyCategories = categories.map(c => chalk.yellow(c)).join(', ');
console.log(`* Found categories: ${prettyCategories}`);

// Domains on this site might not be in DNS yet, or might have been terminated
// through various means (Registry initiated/ICANN initiated)
// More details on terminations can be found 
// https://www.icann.org/resources/pages/gtld-registry-agreement-termination-2015-10-09-en
console.log(`* Diff with root zone: ${diffArrayUnordered(ianaDBTLDs.map(o => o.tld), rootZoneTLDStrs)}`);
console.log('(note): TLDs might be in this source but not in the root zone if the TLD is delegated but not in DNS or if the registry service has been terminated');

// Combine using previous data, but use root zone as source of truth
console.log('Combining with previous data');
tlds.forEach(o => {
  // If this fails, the TLD in the root zone had no category information, which
  // shouldn't happen. The list should be exhaustive
  o.category = ianaDBTLDs.find(o2 => o.tld === o2.tld).category;
})
console.log('Combined');

// == 3. Finding TLD restrictions ==
// These aren't even easy to figure out because registries sometimes just let
// random shit through, like .cat and nyan.cat. And there's always the possibility
// of fulfilling the criteria through the use of someone else registering
//
// = gTLD restrictions =
// This is NOT easy, each gTLD basically can have it's own restrictions negotiated
// with ICANN found in the registry agreement. The registry agreement governs a
// ton of boilerplate business stuff, like SLA. We are most interested in:
// * Specification 12 - This is where Registry level restrictions will usually be
// found. Most registry agreements won't have this (the redline document shows it
// deleted).
// * Specification 13 - Designates the TLD as a brand TLD, which... idk what this
// means but is used for specific companies. A separate document from the original
// registry agreement
// * Exhibit A - Lists services that the Registry will provide. .law adds it's
// restriction clause to Exhibit A with pretty vague language. This is not
// in the initial registry agreement, but in a later amendment.
//
// It seems like these restrictions can sometimes also be in the registries
// terms of service and/or acceptable use policy. At that point... There's not
// much we can do but manual human data manipulation, and I don't know how
// legally binding that is anyway.
//
// All documents related to registry agreements are found here:
// https://www.icann.org/resources/pages/registries/registries-agreements-en
// and the "Terminated" and "Archived" tabs also provide other TLDs that
// are not gTLDs
//
// = ccTLD restrictions =
// TODO
//
// = Other resitrctions =
// 
// ===
async function gTLDInfoFromRegistryAgreement(gTLD) {
  console.log(`Fetching gTLD registry agreement page for ${gTLD}`);
  const resp = await fetch(`https://www.icann.org/en/about/agreements/registries/${gTLD}`);
  const text = await resp.text();

  console.log(`Parsing gTLD registry agreement page for ${gTLD}`);
  const dom = new JSDOM(text);
  const hasSpec13 = !!dom.window.document.querySelector('#spec13');

  // It's a relative href to site root
  const baseRegistryAgreementHTMLHref = dom.window.document.querySelector('#agmthtml a')
    .getAttribute('href');

  console.log(`Fetching gTLD registry agreement HTML for ${gTLD}`);
  const resp2 = await fetch(`https://www.icann.org${baseRegistryAgreementHTMLHref}`);
  const text2 = await resp2.text();

  const hasSpec12 = text2.includes("SPECIFICATION 12");

  const ret = {
    isBrand: hasSpec13,
    hasRestrictions: hasSpec12
  };
  console.log(`Got data for ${gTLD}`, ret);
  return ret;
}

console.log(heading('== TLD information from registry agreements =='));
const manualData = {
  // generic
  com: { isBrand: false, hasRestrictions: false },
  info: { isBrand: false, hasRestrictions: false },
  net: { isBrand: false, hasRestrictions: false },
  org: { isBrand: false, hasRestrictions: false },

  // sponsored (sTLD)
  aero: { isBrand: false, hasRestrictions: true },
  asia: { isBrand: false, hasRestrictions: true },
  cat: { isBrand: false, hasRestrictions: true },
  coop: { isBrand: false, hasRestrictions: true },
  edu: { isBrand: false, hasRestrictions: true },
  gov: { isBrand: false, hasRestrictions: true },
  int: { isBrand: false, hasRestrictions: true },
  jobs: { isBrand: false, hasRestrictions: true },
  mil: { isBrand: false, hasRestrictions: true },
  mobi: { isBrand: false, hasRestrictions: true },
  tel: { isBrand: false, hasRestrictions: true },
  travel: { isBrand: false, hasRestrictions: true },
  xxx: { isBrand: false, hasRestrictions: true },

  // generic-restricted
  biz: { isBrand: false, hasRestrictions: true },
  name: { isBrand: false, hasRestrictions: true },
  pro: { isBrand: false, hasRestrictions: true },

  // infrastructure
  arpa: { isBrand: false, hasRestrictions: true }
};

await mapLimit(tlds, 5, async o => {
  if(manualData[o.tld]) {
    Object.assign(o, manualData[o.tld]);
    return;
  }
  // All gTLDs are marked 'generic', but also includes some that aren't new gTLDs
  // like .com and .net
  else if(o.category === 'generic') {
    await new Promise((resolve) => resolve());
    const asciiTLD = punycode.toASCII(o.tld);
    const info = await gTLDInfoFromRegistryAgreement(asciiTLD);
    Object.assign(o, info);
    return;
  }
});
console.log(JSON.stringify(tlds, null, 2));

})();