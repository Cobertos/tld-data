import fs from 'fs';
import { promisify } from 'util';
import dayjs from 'dayjs';
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
      open: dayjs('16 Nov 2020', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('16 Dec 2020', 'D MMM YYYY', true).format('YYYY-MM-DD'),
    }, {
      name: 'Trademark Claims',
      open: dayjs('2 Mar 2021', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('31 May 2021', 'D MMM YYYY', true).format('YYYY-MM-DD'),
    }, {
      name: 'Sunrise 2',
      open: dayjs('11 Jan 2021', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('28 Feb 2021', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Limited Registration Period'
    }],
    isNotGenerallyAvailable: dayjs().isBefore(dayjs('28 Feb 2021', 'D MMM YYYY', true))
  }, {
    tld: 'москва',
    spec13: false,
    periods: [{
      name: 'Sunrise',
      open: dayjs('10 Jun 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('10 Jul 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
    }, {
      name: 'Trademark Claims',
      open: dayjs('24 Sep 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('4 Jan 2022', 'D MMM YYYY', true).format('YYYY-MM-DD'),
    }, {
      name: 'Limited Registration Period III',
      open: dayjs('4 Sep 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('22 Sep 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Limited Registration Period'
    }, {
      name: '-',
      open: dayjs('12 May 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('10 Jul 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Qualified Launch Program'
    }, {
      name: 'Limited Registration Period I',
      open: dayjs('15 Jul 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('13 Aug 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Limited Registration Period'
    }, {
      name: 'Limited Registration Period II',
      open: dayjs('19 Aug 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('25 Aug 2014', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Limited Registration Period'
    }, {
      name: '.xn--80adxhks - exclusive registration start-date period information submission',
      open: dayjs('20 Apr 2016', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      close: dayjs('20 May 2016', 'D MMM YYYY', true).format('YYYY-MM-DD'),
      type: 'Exclusive Registration Period'
    }],
    isNotGenerallyAvailable: dayjs().isBefore(dayjs('22 Sep 2014', 'D MMM YYYY', true)),
  },  {
    tld: 'itv',
    spec13: true,
    periods: [{
      name: 'Trademark Claims',
      open: dayjs('26 Sep 2016', 'D MMM YYYY', true).format('YYYY-MM-DD'),
    }],
    isNotGenerallyAvailable: true
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