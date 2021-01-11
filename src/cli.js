import argparse from 'argparse';
import { getTLDData } from './fetch.js';

// Reads full buffer out of stream
async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk); 
  return Buffer.concat(chunks).toString('utf8');
}

// Checks stream for any previously output data to use to supplement request
// heavy portions of the update loop
async function readPrevious(stream) {
  const inStr = await read(stream);
  if(inStr) {
    // Parse the previous data and return the JSON
    // object, but with the TLDs mapped to keys
    const inObj = JSON.parse(inStr);
    return inObj
      .map(({tld, isBrand, hasRestrictions}) => {
        return {
          [tld]: { isBrand, hasRestrictions }
        };
      })
      .reduce(Object.assign, {});
  }
}

async function main() {
  // Parse args
  const parser = new argparse.ArgumentParser({
    description: 'Fetch TLD Data'
  });

  // TODO: Version... why does node make it so hard to just make normal modules
  // work...
  parser.add_argument('-v', '--version', { action: 'version', version: '1.1.0' });
  parser.add_argument('-s', '--stdin', { action: 'store_true', help: 'Read previously output data on STDIN to reuse some old data to reduce amount of web scraping requests needed.' });
  parser.add_argument('--color', { action: 'store_true', help: 'Pass in for chalk to force color output (should work by default... but doesnt)' });

  const args = parser.parse_args();
  let prevData;
  if(args.stdin) {
    prevData = await readPrevious(process.stdin);
  }
  const tldObjs = await getTLDData(prevData);
  process.stdout.write(JSON.stringify(tldObjs, null, 2));
}

main();
