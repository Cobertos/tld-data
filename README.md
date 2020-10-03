<p align="center">
    <a href="https://github.com/Cobertos/tld-data/actions" target="_blank"><img alt="build status" src="https://github.com/Cobertos/tld-data/workflows/Fetch%20Data/badge.svg"></a>
    <a href="https://twitter.com/cobertos" target="_blank"><img alt="twitter shield" src="https://img.shields.io/badge/twitter-%40cobertos-0084b4.svg"></a>
    <a href="https://cobertos.com" target="_blank"><img alt="website shield" src="https://img.shields.io/badge/website-cobertos.com-888888.svg"></a>
</p>

# tld-data

Accurate data on TLDs with a focus on registration restrictions.

Methodology:

* Pull all TLDs from [DNS root zone](http://www.internic.net/domain/root.zone) for accuracy (disregards upcoming and terminated TLDs)
* Combines with type information from [IANA root zone database](https://www.iana.org/domains/root/db)
* Scrapes ICANN registry agreements for other information to get as close to the source as possible

## Data

[`tldData.json`](tldData.json) contains an array with an object for every TLD in the [root zone](http://www.internic.net/domain/root.zone). Each object has other properties shown in the below snippet assembled from multiple sources.

```javascript
{
  // TLD, no leading '.', unicode (not punycode)
  "tld": "accenture",

  // type of the TLD from IANA database
  // ['generic', 'country-code', 'sponsored', 'infrastructure', 'generic-restricted', 'test']
  // An explanation of each can be found: https://icannwiki.org/Generic_top-level_domain
  "type": "generic",

  // If present, is the generic TLD a brand TLD?
  // More specifically, does the registry agreement for this TLD specify "Specification 13"
  // or have an exemption to "Specification 9"
  "isBrand": true,

  // If present, are there any restrictions for registering the TLD?
  // Only checks for "Specification 12" currently (see notes in code)
  // Not super accurate yet, and not currently implemented for ccTLDs!
  "hasRestrictions": false
},
```

## Running

`fetchData.js` prints data to stdout and takes previously found data from stdin (to reuse in certain portions to reduce HTTP requests).

You can run the command to generate all new data:

`node --experimental-modules fetchData.js --color > tldData.json`

Or to reuse the old `isBrand` and `hasRestrictions` keys, you can run:

```
echo tldData.json | node --experimental-modules fetchData.js --color > tldDataNew.json
mv -f tldDataNew.json tldData.json
```
