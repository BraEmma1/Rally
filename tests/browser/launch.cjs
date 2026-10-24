// Starts a headless Chromium-family browser for the suites.
//
//   CHROME_PATH  path to a Chrome / Chromium / Edge executable (optional)
//
// Without CHROME_PATH it asks playwright-core for the installed Google Chrome
// ("chrome" channel). playwright-core ships no browser of its own, so one of the
// two must exist on the machine. Safari / WebKit and real devices are NOT covered.
const { chromium } = require('playwright-core')

function launchBrowser() {
  const executablePath = process.env.CHROME_PATH
  return chromium.launch(executablePath ? { executablePath, headless: true } : { channel: 'chrome', headless: true })
}

module.exports = { launchBrowser }
