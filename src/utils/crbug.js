const fetch = require('node-fetch');
const chrome = require('chrome-cookies-secure');
const { color } = require('./logging');

const BASE_URL = 'https://bugs.chromium.org';
const GET_ISSUE = '/prpc/monorail.Issues/GetIssue';

async function getChromeCookies(url) {
  const cookies = await chrome.getCookiesPromised(url);

  return cookies;
}

async function getXsrfToken(cookies) {
  const html = await fetch(BASE_URL, {
    headers: {
      Cookie: `SACSID=${cookies.SACSID}`,
    },
  }).then(r => r.text());
  const m = /'token': '(.+?)'/.exec(html);
  if (!m) {
    throw new Error("Couldn't find xsrf token.");
  }
  return m[1];
}

async function getBugInfo(bugNr) {
  const cookies = await getChromeCookies(BASE_URL);
  const xsrfToken = await getXsrfToken(cookies);

  const options = {
    issueRef: {
      projectName: 'chromium',
      localId: bugNr,
    },
  };
  const result = await fetch(`${BASE_URL}${GET_ISSUE}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `SACSID=${cookies.SACSID}`,
      'x-xsrf-token': xsrfToken,
    },
    body: JSON.stringify(options),
    method: 'POST',
  })
    .then(j => j.text())
    .then(t => JSON.parse(t.substr(4)));

  return result;
}

async function getCveForBugNr(bugNr) {
  try {
    const bugInfo = await getBugInfo(bugNr);
    const cve = bugInfo.issue.labelRefs.find(l => /^CVE-/.test(l.label));

    return cve.label;
  } catch (error) {
    console.log(color.err, error);
  }

  return '';
}

module.exports = {
  getCveForBugNr,
};
