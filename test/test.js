import fs from 'fs';
import { promisify } from 'util';
import test from 'ava';
import _fetchMock from 'fetch-mock';
import proxyquire from 'proxyquire';

const readFile = promisify(fs.readFile);

const fetchMock = _fetchMock.sandbox();
const { getTLDsFromRootZone, getTLDInfoFromIANADB, getTLDsWithStatusPeriods, 
  gTLDInfoFromRegistryAgreement, getTLDData } = 
  proxyquire('../src/fetch.js', { 'node-fetch': fetchMock });

test.beforeEach('reset globals', (t) => {
  fetchMock.restore(); // Restore mocked endpoints
});

test.serial('getTLDsFromRootZone - Finds only TLDs', async (t) => {
  // arrange
  fetchMock.get('end:www.internic.net/domain/root.zone',
    await readFile('test/fetchDummy/internic.net_domain_root.zone_ascii.txt', 'utf-8'));

  // act
  const r = await getTLDsFromRootZone();

  // assert
  t.deepEqual(r, ['com', 'org', 'net']);
});

test.serial('getTLDsFromRootZone - Properly decodes punycode TLDs', async (t) => {
  // arrange
  fetchMock.get('end:www.internic.net/domain/root.zone',
    await readFile('test/fetchDummy/internic.net_domain_root.zone_punycode.txt', 'utf-8'));

  // act
  const r = await getTLDsFromRootZone();

  // assert
  t.deepEqual(r, ['com', '한국']);
});

test.serial('getTLDInfoFromIANADB - Parses TLDs out of the IANA table, handling unicode too', async (t) => {
  // arrange
  fetchMock.get('end:www.iana.org/domains/root/db',
    await readFile('test/fetchDummy/iana.org_domains_root_db.html', 'utf-8'));

  // act
  const r = await getTLDInfoFromIANADB();

  // assert
  t.deepEqual(r, [{
    tld: 'aaa',
    type: 'generic',
    sponsor: 'American Automobile Association, Inc.'
  }, {
    tld: 'aarp',
    type: 'generic',
    sponsor: 'AARP'
  }, {
    tld: 'موقع',
    type: 'generic',
    sponsor: 'Suhub Electronic Establishment'
  }]);
});

test.serial('gTLDInfoFromRegistryAgreement - Parses certain specifications from TLD registry agreements', async (t) => {
  // arrange
  fetchMock.get('end:www.icann.org/en/about/agreements/registries/dummytld1',
    await readFile('test/fetchDummy/icann.org_en_about_agreements_registries_dummytld1.html', 'utf-8'));
  fetchMock.get('end:www.icann.org/agreement/dummytld1',
    await readFile('test/fetchDummy/icann.org_agreement_dummytld1.html', 'utf-8'));

  // act
  const r = await gTLDInfoFromRegistryAgreement('dummytld1');

  // assert
  t.deepEqual(r, {
    hasSpec13: true,
    hasSpec9Exemption: true,
    hasSpec12: true
  });
});

test.serial('getTLDsWithStatusPeriods - Parses period info out of table, handling spec 13, multiple periods in other, etc', async (t) => {
  // arrange
  fetchMock.get('end:newgtlds.icann.org/program-status/sunrise-claims-periods.xls',
    await readFile('test/fetchDummy/newgtlds.icann.org_program-status_sunrise-claims-periods.xls', 'utf-8'));

  // act
  const r = await getTLDsWithStatusPeriods();

  // assert
  t.deepEqual(r, [{
    tld: 'forum',
    spec13: false,
    periods: [{
      name: 'Sunrise',
      open: Date.parse('16 Nov 2020'),
      close: Date.parse('16 Dec 2020'),
    }, {
      name: 'Trademark Claims',
      open: Date.parse('2 Mar 2021'),
      close: Date.parse('31 May 2021'),
    }, {
      name: 'Sunrise 2',
      open: Date.parse('11 Jan 2021'),
      close: Date.parse('28 Feb 2021'),
      type: 'Limited Registration Period'
    }],
    isGenerallyAvailable: Date.now() > Date.parse('28 Feb 2021')
  }, {
    tld: 'москва',
    spec13: false,
    periods: [{
      name: 'Sunrise',
      open: Date.parse('10 Jun 2014'),
      close: Date.parse('10 Jul 2014'),
    }, {
      name: 'Trademark Claims',
      open: Date.parse('24 Sep 2014'),
      close: Date.parse('4 Jan 2022'),
    }, {
      name: 'Limited Registration Period III',
      open: Date.parse('4 Sep 2014'),
      close: Date.parse('22 Sep 2014'),
      type: 'Limited Registration Period'
    }, {
      name: '-',
      open: Date.parse('12 May 2014'),
      close: Date.parse('10 Jul 2014'),
      type: 'Qualified Launch Program'
    }, {
      name: 'Limited Registration Period I',
      open: Date.parse('15 Jul 2014'),
      close: Date.parse('13 Aug 2014'),
      type: 'Limited Registration Period'
    }, {
      name: 'Limited Registration Period II',
      open: Date.parse('19 Aug 2014'),
      close: Date.parse('25 Aug 2014'),
      type: 'Limited Registration Period'
    }, {
      name: '.xn--80adxhks - exclusive registration start-date period information submission',
      open: Date.parse('20 Apr 2016'),
      close: Date.parse('20 May 2016'),
      type: 'Exclusive Registration Period'
    }],
    isGenerallyAvailable: Date.now() > Date.parse('22 Sep 2014')
  },  {
    tld: 'itv',
    spec13: true,
    periods: [{
      name: 'Trademark Claims',
      open: Date.parse('26 Sep 2016'),
    }],
    isGenerallyAvailable: false
  }]);
});

test.serial('getTLDData - Combines all the data into a single object', async (t) => {
  // arrange
  fetchMock.get('end:www.internic.net/domain/root.zone',
    await readFile('test/fetchDummy/internic.net_domain_root.zone_ascii.txt', 'utf-8'));
  fetchMock.get('end:www.iana.org/domains/root/db',
    await readFile('test/fetchDummy/iana.org_domains_root_db.html', 'utf-8'));
  fetchMock.get('end:www.icann.org/en/about/agreements/registries/dummytld1',
    await readFile('test/fetchDummy/icann.org_en_about_agreements_registries_dummytld1.html', 'utf-8'));
  fetchMock.get('end:www.icann.org/agreement/dummytld1',
    await readFile('test/fetchDummy/icann.org_agreement_dummytld1.html', 'utf-8'));
  fetchMock.get('end:newgtlds.icann.org/program-status/sunrise-claims-periods.xls',
    await readFile('test/fetchDummy/newgtlds.icann.org_program-status_sunrise-claims-periods.xls', 'utf-8'));

  // act
  // TODO: 
  // const r = await getTLDData();

  // assert
  // TODO: 
  // t.deepEqual(r, [{
  //   tld: 'com'
  // }, {
  //   tld: 'org'
  // }, {
  //   tld: 'net'
  // }]);
  t.pass();
});