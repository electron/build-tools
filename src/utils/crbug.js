const fetch = require('node-fetch');
const chrome = require('@marshallofsound/chrome-cookies-secure');
const { fatal } = require('./logging');

const BASE_URL = 'https://issues.chromium.org';

const getPayload = (html, start, end) =>
  html.substring(html.indexOf(start) + start.length, html.indexOf(end));

async function getXsrfToken(osid) {
  const html = await fetch(`${BASE_URL}/issues`, {
    headers: {
      Cookie: `OSID=${osid}`,
      'Content-Type': 'application/json',
    },
  }).then((r) => r.text());

  const DATA_START = 'var buganizerSessionJspb = ';
  const DATA_END = '; var defrostedResourcesJspb';

  const payload = getPayload(html, DATA_START, DATA_END);
  const parsed = JSON.parse(payload);

  // There won't be a valid xsrf token for unsigned-in users.
  if (parsed[0][4] === 'ANONYMOUS') {
    return null;
  }

  return parsed[2];
}

async function getBugInfo(bugNr) {
  const profile = process.env.CHROME_SECURITY_PROFILE ?? 'Profile 1';
  const { OSID } = await chrome.getCookiesPromised(BASE_URL, 'object', profile);
  const xsrfToken = await getXsrfToken(OSID);

  // Endpoint found via the included buganizer js file in script tag of BASE_URL.
  const result = await fetch(`${BASE_URL}/action/issues/${bugNr}`, {
    headers: {
      Accept: '*/*',
      Cookie: `OSID=${OSID}`,
      'x-xsrf-token': xsrfToken,
    },
    method: 'GET',
  })
    .then((r) => r.text())
    .then((rawJSON) => {
      // This API call can sometimes return errant invalid characters at the start of the response.
      let cleaned;
      if (rawJSON.indexOf('[') > -1) {
        cleaned = rawJSON.substring(rawJSON.indexOf('['), rawJSON.length);
      } else if (rawJSON.indexOf('{') > -1) {
        cleaned = rawJSON.substring(rawJSON.indexOf('{'), rawJSON.length);
      } else {
        throw new Error(`Unxpected payload received for issue ${bugNr}`);
      }

      return JSON.parse(cleaned);
    });

  if (/IamPermissionDeniedException/.test(result.message)) {
    throw new Error(`Requested access to issue with insufficient permissions ${bugNr}`);
  }

  return result;
}

function parseCveFromIssue(issue) {
  const CVE_ID = 1223136;

  const issueData = issue[0][1];
  const issueMetaData = issueData[issueData.length - 1];
  const cveData = issueMetaData[2][14].find((d) => d[0] === CVE_ID);
  const cve = cveData[cveData.length - 2];

  return /\d{4}-\d{4,7}/.test(cve) ? `CVE-${cve}` : null;
}

async function getCveForBugNr(bugNr) {
  if (Number.isNaN(bugNr)) {
    throw new Error(`Invalid Chromium bug number ${bugNr}`);
  }

  try {
    const issue = await getBugInfo(bugNr);
    return parseCveFromIssue(issue);
  } catch (error) {
    throw new Error(`Failed to fetch CVE for ${bugNr} - ${error}`);
  }
}

module.exports = {
  getCveForBugNr,
};
