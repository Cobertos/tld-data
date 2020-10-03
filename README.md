<p align="center">
    <a href="https://github.com/Cobertos/tld-data/actions" target="_blank"><img alt="build status" src="https://github.com/Cobertos/tld-data/workflows/Fetch%20Data/badge.svg"></a>
    <a href="https://twitter.com/cobertos" target="_blank"><img alt="twitter shield" src="https://img.shields.io/badge/twitter-%40cobertos-0084b4.svg"></a>
    <a href="https://cobertos.com" target="_blank"><img alt="website shield" src="https://img.shields.io/badge/website-cobertos.com-888888.svg"></a>
</p>

# tld-data

Data on TLDs, specifically for figuring out which ones can be registered by the general public.

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
  "isBrand": true,

  // If present, are there any restrictions for registering the TLD?
  // Not super accurate yet, and not currently implemented for ccTLDs!
  "hasRestrictions": false
},
```

## Running

`node --experimental-modules fetchData.js`
