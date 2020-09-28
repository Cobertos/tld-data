<p align="center">
    <a href="https://github.com/Cobertos/tld-data/actions" target="_blank"><img alt="build status" src="https://github.com/Cobertos/tld-data/workflows/Fetch%20Data/badge.svg"></a>
    <a href="https://twitter.com/cobertos" target="_blank"><img alt="twitter shield" src="https://img.shields.io/badge/twitter-%40cobertos-0084b4.svg"></a>
    <a href="https://cobertos.com" target="_blank"><img alt="website shield" src="https://img.shields.io/badge/website-cobertos.com-888888.svg"></a>
</p>

# tld-data

Data on TLDs, specifically for figuring out which ones can be registered by the general public.

Automatically updates weekly with Github Actions

## Data

[`tldData.json`](tldData.json) contains an array with an object for every TLD in the [root zone](http://www.internic.net/domain/root.zone). Each object has other properties shown in the below snippet assembled from multiple sources.

```javascript
{
  // TLD, no leading '.', unicode (not punycode)
  "tld": "accenture",

  // category of the TLD from IANA database
  // ['generic', 'country-code', 'sponsored', 'infrastructure', 'generic-restricted', 'test']
  // An explanation of each can be found: https://icannwiki.org/Generic_top-level_domain
  "category": "generic",

  // Is the generic TLD a brand TLD?
  // More specifically, does the registry agreement for this TLD specify
  // "Specification 13"
  // Not included for all TLDs!
  "isBrand": true,

  // Are there any restrictions for registering the TLD?
  // Not completely accurate, but checks if the registry agreement for this TLD
  // specifies "Specification 12". See the code for notes on how this can be
  // improved.
  // Not included for all TLDs! (specifically ccTLDs!)
  "hasRestrictions": false
},
```

## Running

`node --experimental-modules fetchData.js`
